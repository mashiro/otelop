package startup

import (
	"os/exec"
	"path/filepath"
)

// shimLayout describes a version manager's tree: executables live under
// <prefix>/<installs>/... and a launcher at a stable path lives in <prefix>/<shims>.
type shimLayout struct{ installs, shims string }

var miseLayout = shimLayout{installs: "installs", shims: "shims"}

// Other managers can be supported by defining their layout and listing it here.
var shimLayouts = []shimLayout{miseLayout}

// ShimFor returns the first existing shim derived from candidates, or "".
// The shim is derived from path shape alone so it keeps working across upgrades
// without resolving symlinks or consulting the version manager.
func ShimFor(candidates []string) string {
	for _, candidate := range candidates {
		if !filepath.IsAbs(candidate) {
			continue
		}
		for _, layout := range shimLayouts {
			for dir := filepath.Dir(candidate); dir != filepath.Dir(dir); dir = filepath.Dir(dir) {
				if filepath.Base(dir) != layout.installs {
					continue
				}
				shim := filepath.Join(filepath.Dir(dir), layout.shims, filepath.Base(candidate))
				if found, err := exec.LookPath(shim); err == nil {
					return found
				}
			}
		}
	}
	return ""
}
