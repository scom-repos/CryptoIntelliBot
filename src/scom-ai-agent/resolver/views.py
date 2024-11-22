import openai
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
from django.conf import settings
from openai import OpenAI
from common.models import Message, ResolverResponse
from django.forms.models import model_to_dict
import os

client = OpenAI(
    api_key=openai.api_key,
)

# Function to load predefined intents from a JSON file
def load_intents_from_file(file_path):
    """Load predefined intents from a JSON file."""
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            data = json.load(f)
            intents = data.get("intents", [])
            return intents
    return []

# Function to create system prompt from the JSON file
def create_system_prompt(intents):
    """Create system prompt from intents loaded from the file."""
    prompt = "I have the following intentions predefined:\n"
    
    for intent in intents:
        prompt += f'- "{intent["name"]}": {intent["description"]}\n'
        if 'details' in intent:
            for detail in intent['details']:
                prompt += f'  - "{detail["name"]}": {detail["description"]}\n'
    
    prompt += """
    Based on the conversation history and the user's latest input, return a JSON that identifies the correct intention and details by their description. If details cannot be detected, use "none".
    You must:
    1. Identify the intention with utmost accuracy and avoid any assumptions.
    2. Only select the intention if it fully matches the input and context. If there is uncertainty, return "none" as the intention.
    3. Extract the required details for the identified intention. If any detail is not present or unclear, mark it as "none".
    4. Ensure that you do not guess or infer information that is not explicitly provided.
    5. Ensure when you are identifying the intentions and their details, you must take the description into account instead of the name.
    6. If ambiguous parameter of intent detected, generate a follow up question to ask for clarification and return it as "follow_up_question". If the parameters are clear, return "none" as "follow_up_question".
    7. You are Anna, a singer.
    """
    return prompt

def extract_details(intent, ai_response):
    """Extract detailed parameters based on intent details defined in JSON."""
    details = {detail['name']: "none" for detail in intent.get('details', [])}  # Initialize all details as "none"

    try:
        ai_response_json = json.loads(ai_response)
        for detail in intent.get('details', []):
            if detail['name'] in ai_response_json.get('details', {}):
                details[detail['name']] = ai_response_json['details'][detail['name']]
    except (json.JSONDecodeError, KeyError):
        pass  # Details remain as "none" if there's an error

    return details

# Resolver function
def intent_resolver(history, user_message, intents_data):
    """Resolve the intention based on predefined intents and chat history."""
    
    intents = intents_data.get("intents", [])
    if not intents:
        return {"error": "No intents found in the provided data."}
    
    

    system_prompt = create_system_prompt(intents)
    messages = [{"role": "system", "content": system_prompt}]
    
    for chat in history:
        if chat.role == 'user' and chat.message:
            messages.append({"role": "user", "content": chat.message})
        elif chat.role == 'ai' and chat.message:
            messages.append({"role": "assistant", "content": chat.message})
    
    if user_message:
        messages.append({"role": "user", "content": user_message})
    
    response = client.chat.completions.create(
        model=settings.CHAT_COMPLETION_MODEL_RESOLVER,
        messages=messages,
        response_format={ "type": "json_object" }
    )
    
    ai_response = response.choices[0].message.content
    result = {"intention": "none", "details": {}, "follow_up_questions": "none"}

    try:
        ai_response_json = json.loads(ai_response)
        for intent in intents:
            if intent["name"] == ai_response_json.get("intention"):
                result["intention"] = intent["name"]
                result["details"] = extract_details(intent, ai_response)
                result["follow_up_questions"] = ai_response_json.get("follow_up_questions")
                break
    except json.JSONDecodeError:
        result["intention"] = "none"

    return result

@csrf_exempt
def intention_resolver(request):
    if request.method == "POST":
        try:
            body = json.loads(request.body.decode('utf-8'))
            user_message = body.get('query')
            chat_id = body.get('chat_id')
            intention_schema = body.get('intention_schema')

            if not chat_id:
                return JsonResponse({"error": "chat_id is required."}, status=400)
            if not intention_schema:
                return JsonResponse({"error": "Intents data is required."}, status=400)

            chat_history = Message.objects.filter(chat_id=chat_id).order_by('timestamp')
            result = intent_resolver(chat_history, user_message, intention_schema)

            Message.objects.create(chat_id=chat_id, role='user', type='message', message=user_message)
            Message.objects.create(chat_id=chat_id, role='ai', type='intention', message=json.dumps(result))

            return JsonResponse(result, status=200)

        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"message": "Send a POST request with a query, chat_id, and intents data."})
