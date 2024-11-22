from django.urls import path
from . import views

urlpatterns = [
    path('generate_embeddings/', views.generate_embeddings, name='generate_embeddings'),
    path('retrieve_augment_generate/', views.retrieve_augment_generate, name='retrieve_augment_generate'),
    path('chat_detail/<str:chat_id>/', views.get_chat_detail, name='chat_detail'),
    path('config_chat/', views.config_chat, name='config_chat'),
    path('generate_metadata_embeddings/', views.generate_metadata_embeddings, name='generate_metadata_embeddings'),
    path('retrieve_meta_data/', views.retrieve_meta_data, name='retrieve_meta_data'),
]
