//go:build !embed

package otelop

import (
	"io/fs"
	"os"
)

// FrontendFS returns the frontend/dist directory from the local filesystem.
// Used in development mode without the embed build tag.
func FrontendFS() fs.FS {
	return os.DirFS("frontend/dist")
}
