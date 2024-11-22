from django.db import models
from typing import Optional

class Message(models.Model):
    ROLE_CHOICES = [
        ('user', 'User'),
        ('ai', 'AI'),
        ('system', 'System')
    ]
    
    TYPE_CHOICES = [
        ('message', 'Message'),
        ('file', 'File')
    ]
    
    chat_id = models.CharField(max_length=255)  # Unique identifier for each chat session
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)  # Role: either 'user' or 'ai'
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)  # Type: 'file' or 'message'
    title = models.CharField(max_length=255, null=True, blank=True)  # Title of the file, if type is 'file'
    message = models.TextField(null=True, blank=True)  # User's or AI's message, if type is 'message'
    timestamp = models.DateTimeField(auto_now_add=True)  # Timestamp of when the message was created
    # system_prompt = models.TextField(default="You are a helpful assistant.")  # Bot's personality prompt

    def __str__(self):
        return f"Message {self.chat_id} ({self.role}) at {self.timestamp}"
    

class Chat(models.Model):
    chat_id = models.CharField(max_length=255, unique=True)  # Unique identifier for each chat session
    system_prompt = models.TextField(default="You are a helpful assistant.")  # Custom personality

    def __str__(self):
        return f"Chat {self.chat_id} with personality"
    
class ResolverResponse(models.Model):
    intention: Optional[str]
    details: Optional[any]
    follow_up_questions: Optional[str]
