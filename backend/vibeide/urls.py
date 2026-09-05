from django.contrib import admin
from django.urls import include, path
from allauth.account.decorators import secure_admin_login
from core import views

admin.site.login = secure_admin_login(admin.site.login)
urlpatterns = [
    path("", views.landing, name="landing"),
    path("health", views.health),
    path("accounts/", include("allauth.urls")),
    path("_allauth/", include("allauth.headless.urls")),
    path("account/", views.account, name="account"),
    path("trial/", views.trial, name="trial"),
    path("downloads/<slug:slug>/", views.download, name="download"),
    path("api/v1/me", views.me), path("api/v1/events", views.event),
    path("admin/metrics/", admin.site.admin_view(views.dashboard), name="metrics"),
    path("admin/", admin.site.urls),
]
