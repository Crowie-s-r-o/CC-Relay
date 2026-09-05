from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm, AdminUserCreationForm
from .models import Download, Event, Trial, User, Visit


class ChangeForm(UserChangeForm):
    class Meta(UserChangeForm.Meta):
        model = User

    def clean(self):
        data = super().clean()
        if self.instance.is_superuser and (not data.get("is_superuser") or not data.get("is_active") or not data.get("is_staff")):
            if User.objects.filter(is_superuser=True, is_active=True).exclude(pk=self.instance.pk).count() == 0:
                raise forms.ValidationError("Keep at least one active administrator.")
        return data


class CreateForm(AdminUserCreationForm):
    class Meta(AdminUserCreationForm.Meta):
        model = User
        fields = ("email",)


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    form = ChangeForm
    add_form = CreateForm
    ordering = ("-date_joined",)
    list_display = ("email", "is_active", "is_staff", "date_joined", "last_login")
    search_fields = ("email",)
    readonly_fields = ("date_joined", "last_login", "first_visit")
    fieldsets = ((None, {"fields": ("email", "password")}),
                 ("Access", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions", "must_change_password")}),
                 ("History", {"fields": ("date_joined", "last_login", "first_visit")}))
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return request.user.is_superuser


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Event)
class EventAdmin(ReadOnlyAdmin):
    list_display = ("created_at", "kind", "user", "detail")
    list_filter = ("kind", "created_at")
    search_fields = ("user__email", "detail")
    list_select_related = ("user",)


@admin.register(Visit)
class VisitAdmin(ReadOnlyAdmin):
    list_display = ("created_at", "source", "medium", "campaign", "referrer_host")
    list_filter = ("created_at",)
    search_fields = ("source", "campaign")


@admin.register(Trial)
class TrialAdmin(ReadOnlyAdmin):
    list_display = ("user", "started_at")
    list_select_related = ("user",)


@admin.register(Download)
class DownloadAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "enabled")


admin.site.site_header = "VibeIDE operations"
admin.site.site_title = "VibeIDE admin"
admin.site.index_title = "Manage VibeIDE"

# Identity secrets are configured through mounted files or the user's MFA flow.
from allauth.mfa.models import Authenticator
from allauth.socialaccount.models import SocialApp, SocialToken
for model in (Authenticator, SocialApp, SocialToken):
    if admin.site.is_registered(model):
        admin.site.unregister(model)
