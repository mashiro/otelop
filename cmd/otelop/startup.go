package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	"github.com/mashiro/otelop/internal/startup"
)

func startupCommand() *cli.Command {
	cmd := &cli.Command{
		Name:        "startup",
		Usage:       "Manage automatic startup at user login (macOS / Linux systemd)",
		Description: "Configure the next login without starting or stopping otelop. Uses the existing TOML configuration; shell runtime environment variables are not copied. Uses a verified mise shim or stable symlink when available so upgrades keep working.",
	}
	for _, action := range []string{"enable", "disable", "status"} {
		cmd.Commands = append(cmd.Commands, &cli.Command{
			Name:  action,
			Usage: map[string]string{"enable": "Enable startup at the next login", "disable": "Disable startup at future logins", "status": "Show whether login startup is configured"}[action],
			Action: func(_ context.Context, cmd *cli.Command) error {
				if cmd.Args().Len() != 0 {
					return fmt.Errorf("startup %s accepts no arguments", action)
				}
				home, err := os.UserHomeDir()
				if err != nil {
					return err
				}
				r, err := startup.New(runtime.GOOS, home, os.Getenv("XDG_CONFIG_HOME"))
				if err != nil {
					return err
				}
				switch action {
				case "enable":
					if runtime.GOOS == "linux" {
						if _, err := exec.LookPath("systemctl"); err != nil {
							return fmt.Errorf("login startup requires systemd: %w", err)
						}
					}
					opts, err := startupOptions()
					if err != nil {
						return err
					}
					if err := r.Enable(opts); err != nil {
						return err
					}
					_, err = fmt.Fprintf(cmd.Writer, "Startup enabled for the next login: %s\nUse `otelop start` to start now.\n", r.Path)
					return err
				case "disable":
					if err := r.Disable(); err != nil {
						return err
					}
					_, err = fmt.Fprintln(cmd.Writer, "Startup disabled for future logins. Use `otelop stop` to stop a running server.")
					return err
				default:
					enabled, err := r.Enabled()
					if err != nil {
						return err
					}
					state := "disabled"
					if enabled {
						state = "enabled"
					}
					_, err = fmt.Fprintf(cmd.Writer, "Startup %s: %s\n", state, r.Path)
					return err
				}
			},
		})
	}
	return cmd
}

func startupOptions() (startup.Options, error) {
	exe, err := os.Executable()
	if err != nil {
		return startup.Options{}, err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return startup.Options{}, err
	}
	_, cfgPath, err := config.Load()
	if err != nil {
		return startup.Options{}, err
	}
	cfgPath, err = filepath.Abs(cfgPath)
	if err != nil {
		return startup.Options{}, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return startup.Options{}, err
	}
	env := map[string]string{config.EnvConfigFile: cfgPath, "HOME": home,
		"PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"}
	// Preserve only path context. Runtime credentials and shell-specific settings
	// should be configured explicitly in TOML rather than silently persisted.
	for _, key := range []string{"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "OTELOP_STATE_DIR", "MISE_DATA_DIR", "MISE_CONFIG_DIR", "MISE_CACHE_DIR", "MISE_STATE_DIR", "MISE_GLOBAL_CONFIG_FILE", "MISE_SYSTEM_CONFIG_DIR"} {
		if value := os.Getenv(key); value != "" {
			absolute, err := filepath.Abs(value)
			if err != nil {
				return startup.Options{}, err
			}
			env[key] = absolute
		}
	}
	// Preserve config selectors, but not per-tool version overrides which would
	// pin login startup to the old version after an upgrade.
	for _, key := range []string{"MISE_ENV", "MISE_PROFILE"} {
		if value := os.Getenv(key); value != "" {
			env[key] = value
		}
	}
	opts := startup.Options{Executable: exe, WorkingDirectory: cwd, Environment: env}
	opts.Executable, err = startup.ResolveExecutable(context.Background(), opts, os.Getenv("PATH"))
	if err != nil {
		return startup.Options{}, err
	}
	return opts, nil
}
