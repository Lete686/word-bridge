"""Init."""
# Local compatibility adjustment: this MDX 2.0 file uses zlib. The reader
# already supports lzo=None for files that do not use LZO compression.
from .readmdict import MDX, MDD


__version__ = "0.1.1"
VERSION = __version__.split(".")
__all__ = ("readmdict", "MDX", "MDD")
