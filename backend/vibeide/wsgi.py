from django.conf import settings
from django.core.wsgi import get_wsgi_application
from vibeide import settings as project_settings

if not settings.configured:
    settings.configure(**{k: v for k, v in vars(project_settings).items() if k.isupper()})
application = get_wsgi_application()
