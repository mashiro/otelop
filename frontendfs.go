//go:build embed

package otelop

import (
	"embed"
	"io/fs"
)

//go:embed frontend/dist/*
var frontendDist embed.FS

// FrontendFS returns the embedded frontend filesystem rooted at frontend/dist.
func FrontendFS() fs.FS {
	sub, _ := fs.Sub(frontendDist, "frontend/dist")
	return sub
}
