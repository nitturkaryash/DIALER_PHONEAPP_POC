"""Model package marker.

Keep this file import-light. Importing heavy model modules here can pull in
optional runtime dependencies (e.g. Pipecat) even for lightweight API flows.
"""

from __future__ import annotations

__all__: list[str] = []
