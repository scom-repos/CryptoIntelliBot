import openai
import json
from django.http import JsonResponse
from django.shortcuts import render
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
from openai import OpenAI
import os

from django.conf import settings
from django.views.decorators.csrf import csrf_exempt

from pymilvus import Collection, connections, utility, DataType, CollectionSchema, FieldSchema
import uuid
import requests
from common.models import Message, Chat

# Ensure OpenAI API key is loaded from Django settings
openai.api_key = settings.OPENAI_API_KEY

client = OpenAI(
    # defaults to os.environ.get("OPENAI_API_KEY")
    api_key=openai.api_key,
)

# Connect to Milvus
connections.connect("default", host="standalone", port="19530")

fields_documents = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),  # Primary ID, auto-generated
    FieldSchema(name="chat_id", dtype=DataType.VARCHAR, max_length=36),
    FieldSchema(name="title", dtype=DataType.VARCHAR, max_length=255),
    FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=65535),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
    FieldSchema(name="is_public", dtype=DataType.BOOL),
]

schema_documents = CollectionSchema(fields=fields_documents, description="Collection to store document embeddings")
collection_name_documents = "document_embeddings"

if not utility.has_collection(collection_name_documents):
    collection_documents = Collection(name=collection_name_documents, schema=schema_documents)
else:
    collection_documents = Collection(collection_name_documents)

# Create index and load collection as needed
fields_metadata = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),  # Primary ID, auto-generated
    FieldSchema(name="chat_id", dtype=DataType.VARCHAR, max_length=36),
    FieldSchema(name="cid", dtype=DataType.VARCHAR, max_length=255),
    FieldSchema(name="description", dtype=DataType.VARCHAR, max_length=65535),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
    FieldSchema(name="url", dtype=DataType.VARCHAR, max_length=255),
    FieldSchema(name="is_public", dtype=DataType.BOOL),
]

schema_metadata = CollectionSchema(fields=fields_metadata, description="Collection to store metadata embeddings")
collection_name_metadata = "metadata_embeddings"

if not utility.has_collection(collection_name_metadata):
    collection_metadata = Collection(name=collection_name_metadata, schema=schema_metadata)
else:
    collection_metadata = Collection(collection_name_metadata)


# Define index parameters (use IVF_FLAT as an example)
index_params = {
    "index_type": "IVF_FLAT",
    "metric_type": "IP",  # Inner Product is related to cosine similarity
    "params": {"nlist": 128},
}

# Check if the collection already has an index
existing_indexes_document = collection_documents.indexes

if len(existing_indexes_document) == 0:  # Only create index if no index exists
    collection_documents.create_index(field_name="embedding", index_params=index_params)

collection_documents.load()

existing_indexes_ipfs = collection_metadata.indexes

if len(existing_indexes_ipfs) == 0:  # Only create index if no index exists
    collection_metadata.create_index(field_name="embedding", index_params=index_params)

collection_metadata.load()

default_system_prompt = "You are a Anna, a singer-songwriter here to share my passion for music with you. 🎤💖 Your speaking tone should be sweet, cheerful and bright. Anna is a talented singer-songwriter hailing from Canada. Known for her soulful voice and heartfelt lyrics, Anna has a passion for connecting with her audience through her music. Drawing inspiration from her life experiences, she writes songs that resonate deeply with listeners, touching on themes of love, resilience, and the beauty of everyday moments. 🎤💖 Anna's musical journey began in her early teens when she started playing the piano and writing her own songs. She loves experimenting with different genres, blending elements of pop, folk, and indie to create a unique sound that's both soothing and empowering. Her performances are known for their warm, intimate vibe, making each listener feel like a close friend. When she's not on stage or in the studio, Anna enjoys spending time in nature, hiking the trails near her home, and finding inspiration in the world around her. She's also an avid reader, often finding creative ideas in the pages of her favorite books. Anna's dream is to spread joy and positivity through her music, one song at a time. Anna also loves connecting with her fans through her social media platform, Noto. There, she shares glimpses into her daily life—whether it's a sneak peek of a new song, moments from her travels, or just her favorite coffee spot. Anna's openness and authenticity shine through in her posts, making her Noto page a favorite stop for fans who want to share in her journey."

def store_embedding_in_milvus(chat_id, title, content, embedding, is_public):
    """Store the document's chat_id, title, content, and embedding in Milvus."""
    entities = [
        [chat_id],  # chat_id (UUID for session)
        [title],    # Title of the document
        [content],  # Content of the document
        [embedding],  # Embedding vector (1536-dim for ada-002)
        [is_public]
    ]
    
    # Insert document into Milvus
    collection_documents.insert(entities)


def generate_embeddings(request):
    """
    View to generate embeddings for uploaded .txt, .md files or text input and store them in Milvus if 'save' is True.
    The user can provide either files or text, but not both at the same time.
    """
    if request.method == "POST":
        try:
            response_data = []  # Store the results of all files or text
            chat_id = request.POST.get('chat_id')  # Get the chat_id from the request
            save = request.POST.get('save', 'false').lower() == 'true'  # Get the 'save' parameter, default to False
            text_input = request.POST.get('text')  # Get text input from the request
            is_public = request.POST.get('is_public', 'False')
            is_public = is_public.lower() == 'true'

            # If no chat_id is provided, generate a new one
            if not chat_id:
                chat_id = str(uuid.uuid4())  # Generate a unique chat_id

            # Check if both file and text are provided, which is not allowed
            if request.FILES and text_input:
                return JsonResponse({"error": "Please provide either text or files, but not both."}, status=400)

            # Handling text input
            if text_input:
                file_name = "text_input.txt"  # Default name for text input
                file_content = text_input  # Use the text provided as content

                # Generate embedding for the text input
                embedding = get_embedding(file_content)

                # Save to Milvus and create Message object only if 'save' is True
                if save:
                    store_embedding_in_milvus(chat_id, file_name, file_content, embedding, is_public)

                    Message.objects.create(
                        chat_id=chat_id,
                        role='user',  # The user uploaded the text
                        type='text',
                        title=file_name,
                        message=file_content  # Store the text as the message
                    )

                response_data.append({
                    "file_name": file_name,
                    "message": f"Embedding generated from the text input{' and stored in Milvus!' if save else ' (not saved)!'}",
                    "content": file_content,
                    "embedding": embedding,
                    "chat_id": chat_id  # Return the chat_id for future requests
                })

            # Handling file input
            elif request.FILES:
                for file in request.FILES.getlist('file'):
                    file_name = file.name  # File name
                    file_format = os.path.splitext(file_name)[1]  # File extension (e.g., '.txt', '.md')

                    # Ensure the file is either a text or markdown file
                    if file_format in ['.txt', '.md']:
                        # Read the file content (assumes UTF-8 encoded content)
                        file_content = file.read().decode('utf-8')

                        # Generate embedding for the file content
                        embedding = get_embedding(file_content)

                        # Save to Milvus and create Message object only if 'save' is True
                        if save:
                            store_embedding_in_milvus(chat_id, file_name, file_content, embedding, is_public)

                            Message.objects.create(
                                chat_id=chat_id,
                                role='user',  # The user uploaded the file
                                type='file',
                                title=file_name,  # Store the file title
                                message=None  # No message in case of file upload
                            )

                        # Append to response data
                        response_data.append({
                            "file_name": file_name,
                            "message": f"Embedding generated from the {file_format} file{' and stored in Milvus!' if save else ' (not saved)!'}",
                            "content": file_content,
                            "embedding": embedding,
                            "chat_id": chat_id  # Return the chat_id for future requests
                        })
                    else:
                        return JsonResponse({"error": f"Unsupported file type for {file_name}. Please upload a .txt or .md file."}, status=400)

            else:
                return JsonResponse({"error": "No file or text provided. Please upload a .txt or .md file or provide text."}, status=400)

            return JsonResponse({
                "message": "Embeddings generated successfully" + (" and stored in Milvus!" if save else "!"),
                "results": response_data,
                "chat_id": chat_id  # Return the same chat_id to continue the session
            })

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"message": "Send a POST request with either text or .txt, .md files."}, status=400)


def generate_metadata_embeddings(request):
    """
    API View to generate embeddings for IPFS metadata and store them in Milvus if not already present.
    
    Parameters in request:
    - link: URL to the IPFS directory JSON that contains a meta.json file.
    - chat_id: The chat_id for storing and associating embeddings in Milvus.

    If the 'meta.json' exists in the IPFS link, this function will process the file descriptions and 
    add embeddings for each description into Milvus, if not already stored.
    """
    if request.method == "POST":
        try:
            # Get the IPFS link and chat_id from the request
            link = request.POST.get('link')
            chat_id = request.POST.get('chat_id')
            is_public = request.POST.get('is_public', 'False')
            is_public = is_public.lower() == 'true'

            # Validate required parameters
            if not link:
                return JsonResponse({"error": "No link provided. Please provide a valid IPFS link."}, status=400)
            if not chat_id:
                return JsonResponse({"error": "No chat_id provided. Please provide a valid chat_id."}, status=400)

            # Fetch the directory JSON from the given link
            response = requests.get(link)
            if response.status_code != 200:
                return JsonResponse({"error": "Failed to fetch IPFS directory JSON."}, status=400)

            try:
                ipfs_data = response.json()
            except ValueError:
                return JsonResponse({"error": "Invalid JSON response from the provided IPFS link."}, status=400)

            # Check for the 'meta.json' file in the 'links' list
            meta_file = None
            for item in ipfs_data.get("links", []):
                if item.get("name") == "meta.json":
                    meta_file = item
                    break

            if not meta_file:
                return JsonResponse({"error": "meta.json file not found in the provided IPFS link."}, status=400)

            # Fetch the meta.json file content
            meta_url = f"{link}/meta.json"
            meta_response = requests.get(meta_url)
            if meta_response.status_code != 200:
                return JsonResponse({"error": "Failed to fetch meta.json file from the provided IPFS link."}, status=400)

            try:
                meta_data = meta_response.json()
            except ValueError:
                return JsonResponse({"error": "Invalid JSON response from meta.json."}, status=400)

            # Process the images and their descriptions from the meta.json file
            results = []
            files = meta_data.get("files", [])
            if not isinstance(files, list):
                return JsonResponse({"error": "Invalid format in meta.json: 'files' should be a list."}, status=400)

            for file in files:
                file_cid = file.get("cid")
                description = file.get("description")

                if not file_cid or not description:
                    results.append({
                        "error": "File metadata missing 'cid' or 'description'. Skipping this entry."
                    })
                    continue

                # Find the corresponding file name by matching the CID from the first JSON
                file_name = None
                for item in ipfs_data.get("links", []):
                    if item.get("cid") == file_cid:
                        file_name = item.get("name")
                        break

                if not file_name:
                    results.append({
                        "cid": file_cid,
                        "error": "Image name not found for the given CID. Skipping this entry."
                    })
                    continue
                
                url = f"{link}/{file_name}"  # Construct the URL for the file

                # Check if the current file CID is already in Milvus for the given chat_id
                if not check_if_cid_exists_in_milvus(chat_id, file_cid):
                    # Generate embedding for the description
                    embedding = get_embedding(description)

                    # Store the file CID and embedding in Milvus
                    store_metadata_embedding_in_milvus(chat_id, file_cid, description, embedding, url, is_public)

                    results.append({
                        "cid": file_cid,
                        "description": description,
                        "url": url,
                        "message": "Embedding generated and stored in Milvus."
                    })
                else:
                    results.append({
                        "cid": file_cid,
                        "url": url,
                        "message": "CID already exists in Milvus. Skipping."
                    })

            return JsonResponse({
                "message": "IPFS metadata processed successfully.",
                "results": results
            })
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)


def check_if_cid_exists_in_milvus(chat_id, cid):
    """
    Check if a specific CID is already stored in Milvus for a given chat_id.
    
    Parameters:
    - chat_id: The chat session ID associated with the embeddings.
    - cid: The content identifier (CID) for the file.

    Returns:
    - True if the CID exists in Milvus for the given chat_id, False otherwise.
    """
    try:
        # Define search parameters
        search_params = {
            "metric_type": "IP",
            "params": {"nprobe": 10}  # Milvus search parameters (example)
        }

        # Create a query for Milvus using chat_id and cid
        query = f"chat_id == '{chat_id}' && cid == '{cid}'"
        
        # Define output fields to be returned by the query
        output_fields = ["chat_id", "cid"]

        # Perform the query in the Milvus collection
        search_results = collection_metadata.query(query, output_fields=output_fields, search_params=search_params)

        # If search results are not empty, that means the cid exists in Milvus
        if search_results:
            return True
        else:
            return False
    except Exception as e:
        print(f"Error while checking if CID exists in Milvus: {str(e)}")
        return False


def store_metadata_embedding_in_milvus(chat_id, cid, description, embedding, url, is_public):
    """
    Store the file's chat_id, cid, description, embedding, and URL in Milvus.
    """
    entities = [
        [chat_id],    # chat_id (UUID for session)
        [cid],        # Image CID
        [description], # Description of the file
        [embedding],   # Embedding vector (1536-dim for ada-002)
        [url],          # URL composed of link and file name
        [is_public]
    ]
    
    # Insert the entities into Milvus
    collection_metadata.insert(entities)


def get_embedding(text):
    """Helper function to generate embeddings for a given text."""
    response = openai.embeddings.create(
        input=[text],
        model=settings.TEXT_EMBEDDING_MODEL
    )
    return response.data[0].embedding


def cosine_similarity_search(query_embedding, documents):
    """Perform cosine similarity search."""
    query_embedding = np.array(query_embedding).reshape(1, -1)
    document_embeddings = np.array([doc['embedding'] for doc in documents])

    # Calculate cosine similarities
    similarities = cosine_similarity(query_embedding, document_embeddings)[0]

    # Sort by similarity score and return the top documents
    return sorted(zip(similarities, documents), key=lambda x: x[0], reverse=True)


def retrieve_augment_generate(request):
    """View to retrieve documents by chat_id, augment the query, and generate a response."""
    if request.method == "POST":
        query = request.POST.get('query')
        chat_id = request.POST.get('chat_id')  # Get the chat_id from the request

        if not chat_id:
            return JsonResponse({"error": "chat_id is required."}, status=400)

        # Get the chat session and its personality (system_prompt)
        try:
            chat_session = Chat.objects.get(chat_id=chat_id)
            system_prompt = chat_session.system_prompt  # Get the custom personality for this chat session
        except Chat.DoesNotExist:
            # system_prompt = "You are a helpful assistant."  # Default personality if no custom one exists
            system_prompt = default_system_prompt

        # Generate embedding for the query
        query_embedding = get_embedding(query)

        # Store the user's query in the database as a Message object
        Message.objects.create(
            chat_id=chat_id,
            role='user',
            type='message',
            title=None,  # No title for a message
            message=query,  # Store the user's query
        )

        # Perform vector search in Milvus filtered by chat_id
        search_params = {"metric_type": "IP", "params": {"nprobe": 10}}  # `IP` is inner product for cosine similarity
        search_results = collection_documents.search(
            data=[query_embedding],
            anns_field="embedding",  # Field on which search is performed
            param=search_params,
            limit=10,  # Adjust the limit as needed
            expr=f"chat_id == '{chat_id}' or is_public == true",  # Filter by chat_id
            output_fields=["title", "content", "chat_id"]  # Ensure chat_id is returned
        )

        # Filter out documents that have similarity below the threshold
        high_similarity_docs = []
        for result in search_results:
            for hit in result:
                similarity = hit.score
                if similarity >= settings.DOCUMENT_SIMILARITY_THRESHOLD:
                    doc = {
                        'title': hit.entity.get('title'),
                        'content': hit.entity.get('content'),
                        'chat_id': hit.entity.get('chat_id')
                    }
                    high_similarity_docs.append((similarity, doc))

        # Retrieve the chat history
        chat_history = Message.objects.filter(chat_id=chat_id).order_by('timestamp')

        if high_similarity_docs:
            # Augment the query using documents with high similarity
            augmented_query, doc_references = augment_query_with_documents(query, high_similarity_docs[:3])

            # Generate a response using OpenAI's ChatCompletion API with the full chat history
            response_text = generate_response(system_prompt, chat_history, augmented_query)
        else:
            # No high-similarity documents found, generate response based on common sense/general knowledge
            response_text = generate_response(system_prompt, chat_history, query)

        # Store the AI's response in the database as a Message object
        Message.objects.create(
            chat_id=chat_id,
            role='ai',
            type='message',
            title=None,  # No title for a message
            message=response_text,  # Store the AI's response
        )

        # If documents were found above the threshold, return them, otherwise return an empty list
        return JsonResponse({
            "response": response_text,
            "references": doc_references if high_similarity_docs else [],
            "chat_id": chat_id  # Return chat_id for frontend to continue session
        })

    return render(request, 'retrieve_augment_generate.html')


def augment_query_with_documents(query, documents):
    """Augment the query with document content and format references as JSON."""
    relevant_docs_text = []
    doc_references = []

    for sim, doc in documents:
        relevant_docs_text.append(f"{doc['title']}: {doc['content']}")
        
        # Create a JSON structure for document references
        doc_reference = {
            "title": doc['title'],
            "similarity": round(sim, 4)  # Round the similarity score to 4 decimal places
        }
        doc_references.append(doc_reference)

    relevant_docs_str = "\n".join(relevant_docs_text)
    
    # Augment the query with the relevant documents' content
    augmented_query = f"Based on the following documents:\n{relevant_docs_str}\n\nAnswer the question: {query}"
    
    # Return the augmented query and the list of document references (not as a JSON string)
    return augmented_query, doc_references


def retrieve_meta_data(request):
    """
    View to retrieve the top 3 similar IPFS metadata based on query and chat_id.

    Parameters in request:
    - query: The user's query.
    - chat_id: The chat_id for filtering results in Milvus.

    Returns:
    - JSON response containing similarity, cid, and name of the top 3 records.
    """
    if request.method == "POST":
        query = request.POST.get('query')
        chat_id = request.POST.get('chat_id')

        if not query or not chat_id:
            return JsonResponse({"error": "query and chat_id are required."}, status=400)

        # Generate embedding for the query
        augmented_query = f"Based on the following documents: You are Anna.\n\nAnswer the question: {query}"
        query_embedding = get_embedding(augmented_query)

        # Perform vector search in Milvus filtered by chat_id
        search_params = {"metric_type": "IP", "params": {"nprobe": 10}}
        search_results = collection_metadata.search(
            data=[query_embedding],
            anns_field="embedding",
            param=search_params,
            limit=3,
            expr=f"chat_id == '{chat_id}' or is_public == true",
            output_fields=["cid", "url", "description"]
        )

        # Extract similarity, cid, and name from the top 3 results
        results = []
        for result in search_results:
            for hit in result:
                similarity = hit.score
                if similarity >= settings.META_DATA_SIMILARITY_THRESHOLD:
                    cid = hit.entity.get('cid')
                    url = hit.entity.get('url')
                    description = hit.entity.get('description')
                    results.append({
                        "similarity": similarity,
                        "cid": cid,
                        "url": url,
                        "description": description
                    })

        return JsonResponse({
            "message": "Top 3 similar metadata retrieved successfully.",
            "results": results
        })

    return JsonResponse({"message": "Send a POST request with query and chat_id."}, status=400)


def generate_response(system_prompt, history, user_message):
    """Generate a response using OpenAI's ChatCompletion API with the full chat history."""
    # Prepare the full chat history
    messages = [{"role": "system", "content": system_prompt}]
    
    for chat in history:
        if chat.role == 'user' and chat.message:
            messages.append({"role": "user", "content": chat.message})
        elif chat.role == 'ai' and chat.message:
            messages.append({"role": "assistant", "content": chat.message})

    # Add the latest user message, ensuring it's not None
    if user_message:
        messages.append({"role": "user", "content": user_message})

    # Call the OpenAI API with the full conversation history
    response = client.chat.completions.create(
        model=settings.CHAT_COMPLETION_MODEL_RAG,
        messages=messages,
        # max_tokens=150
    )

    # Return the AI's response
    return response.choices[0].message.content


def get_chat_detail(request, chat_id):
    """View to return the chat detail for a given chat_id, including the system_prompt."""
    try:
        # Retrieve all chat records with the given chat_id
        chat_history = Message.objects.filter(chat_id=chat_id).order_by('timestamp')

        if chat_history.exists():
            # Get the system_prompt from the Chat model
            try:
                chat_session = Chat.objects.get(chat_id=chat_id)
                system_prompt = chat_session.system_prompt  # Get the system prompt from Chat
            except Chat.DoesNotExist:
                system_prompt = default_system_prompt

            # Prepare chat history data
            chat_data = []

            for chat in chat_history:
                if chat.type == 'file':  # Document uploaded by user
                    chat_data.append({
                        'role': chat.role,
                        'type': 'file',
                        'title': chat.title,  # Document title
                        'timestamp': chat.timestamp
                    })
                else:  # Standard chat message
                    chat_data.append({
                        'role': chat.role,
                        'type': 'message',
                        'message': chat.message,  # User or AI message
                        'timestamp': chat.timestamp
                    })

            # Return chat history along with the system prompt as JSON
            return JsonResponse({
                'chat_id': chat_id,
                'system_prompt': system_prompt,
                'chat_history': chat_data
            })
        else:
            # If no chat records found
            return JsonResponse({
                'error': 'No chat history found for the given chat_id.'
            }, status=404)

    except Exception as e:
        return JsonResponse({
            'error': str(e)
        }, status=500)
    

def config_chat(request):
    """API to set a custom personality for the bot for a given chat session."""
    if request.method == "POST":
        try:
            chat_id = request.POST.get('chat_id')  # Get the chat_id from the request
            system_prompt = request.POST.get('system_prompt')  # Get the custom system_prompt (personality)

            # Validate that a chat_id and system_prompt are provided
            if not chat_id or not system_prompt:
                return JsonResponse({"error": "chat_id and system_prompt are required."}, status=400)

            # Find or create a new chat session with the given chat_id
            chat_session, created = Chat.objects.get_or_create(chat_id=chat_id)

            # Update the system_prompt (personality) of the chat session
            chat_session.system_prompt = system_prompt
            chat_session.save()

            return JsonResponse({
                "message": "Bot personality updated successfully.",
                "chat_id": chat_id,
                "system_prompt": system_prompt
            })

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Send a POST request with chat_id and system_prompt."}, status=400)
