package startup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ResolveExecutable selects a stable launch path for the current executable.
// searchPath is the registering process's PATH, while opts.Environment is the
// saved login environment used to verify a mise shim's selected installation.
func ResolveExecutable(ctx context.Context, opts Options, searchPath string) (string, error) {
	executable, cwd, env := opts.Executable, opts.WorkingDirectory, opts.Environment
	current, err := os.Stat(executable)
	if err != nil {
		return "", err
	}
	candidates := []string{}
	for _, dir := range filepath.SplitList(searchPath) {
		if filepath.IsAbs(dir) {
			candidates = append(candidates, filepath.Join(dir, "otelop"))
		}
	}
	data := env["MISE_DATA_DIR"]
	if data == "" {
		data = env["XDG_DATA_HOME"]
		if data == "" {
			data = filepath.Join(env["HOME"], ".local", "share")
		}
		data = filepath.Join(data, "mise")
	}
	candidates = append(candidates, filepath.Join(data, "shims", "otelop"), "/usr/local/share/mise/shims/otelop")
	childEnv := make([]string, 0, len(env))
	for key, value := range env {
		childEnv = append(childEnv, key+"="+value)
	}
	// Ask mise for custom shim directories as well, including when activation
	// deliberately excludes shims from PATH.
	if mise := executableOnPath("mise", searchPath); mise != "" {
		if dir, err := miseOutput(ctx, mise, cwd, childEnv, "settings", "get", "shims_dir"); err == nil && filepath.IsAbs(dir) {
			candidates = append(candidates, filepath.Join(dir, "otelop"))
		}
	}
	for _, candidate := range candidates {
		target, err := filepath.EvalSymlinks(candidate)
		if err != nil || filepath.Base(target) != "mise" {
			continue
		}
		resolved, err := miseOutput(ctx, target, cwd, childEnv, "which", "otelop")
		if err != nil {
			continue
		}
		info, err := os.Stat(resolved)
		if err == nil && os.SameFile(current, info) {
			return candidate, nil
		}
	}
	// Preserve stable package-manager links (including symlinked directories).
	for _, candidate := range append(candidates, executable) {
		resolved, err := filepath.EvalSymlinks(candidate)
		if err != nil || resolved == candidate || filepath.Base(resolved) == "mise" {
			continue
		}
		info, err := os.Stat(candidate)
		if err == nil && os.SameFile(current, info) {
			return candidate, nil
		}
	}
	return executable, nil
}

func miseOutput(ctx context.Context, mise, cwd string, env []string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, mise, args...)
	cmd.Dir = cwd
	cmd.Env = env
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

func executableOnPath(name, searchPath string) string {
	for _, dir := range filepath.SplitList(searchPath) {
		if !filepath.IsAbs(dir) {
			continue
		}
		candidate := filepath.Join(dir, name)
		info, err := os.Stat(candidate)
		if err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0 {
			return candidate
		}
	}
	return ""
}
