# AI Agent Backend

## Step
1. Make a config/config.js file and put your key on it. (refer to the sample_config.js)
2. ```docker-compose up --build```

## Requests

### 1. Upload files for retrieval

 ```http://127.0.0.1:8000/rag/generate_embeddings/```

![alt text]({5707A5B5-135C-4BEB-BC41-8D4AA3D2581F}.png)

### 2. Upload meta data for retrieval

 ```http://127.0.0.1:8000/rag/generate_metadata_embeddings/```

![alt text]({EF20A1A1-DE39-44C4-9782-2CD6FE760724}.png)