#!/usr/bin/env python3
import sys
from django.conf import settings
from django.core.management import execute_from_command_line
from vibeide import settings as project_settings

settings.configure(**{k: v for k, v in vars(project_settings).items() if k.isupper()})
execute_from_command_line(sys.argv)
