"""Allow ``python -m asmap_dashboard <subcommand>`` invocation."""

import sys

from asmap_dashboard.cli import main

if __name__ == "__main__":
    sys.exit(main())
