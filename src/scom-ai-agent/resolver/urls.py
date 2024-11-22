from django.urls import path
from . import views

urlpatterns = [
    path('intention_resolver/', views.intention_resolver, name='intention_resolver'),
]
