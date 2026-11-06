package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/startup"
)

func startupCommand() *cli.Command {
	return &cli.Command{
		Name:        "startup",
		Usage:       "Manage automatic startup at user login (macOS / Linux systemd)",
		Description: "Configure the next login without starting or stopping otelop. Uses the login service environment and normal configuration lookup without saving the current directory or shell environment. Uses --executable when specified on enable, otherwise a version manager shim when available, then otelop on PATH.",
		Commands: []*cli.Command{
			startupEnableCommand(),
			startupDisableCommand(),
			startupStatusCommand(),
		},
	}
}

func startupEnableCommand() *cli.Command {
	return &cli.Command{
		Name:  "enable",
		Usage: "Enable startup at the next login",
		Flags: []cli.Flag{
			&cli.StringFlag{Name: "executable", Usage: "absolute path to the executable to start (default: auto-detect)"},
		},
		Action: runStartupEnable,
	}
}

func runStartupEnable(_ context.Context, cmd *cli.Command) error {
	if cmd.Args().Len() != 0 {
		return fmt.Errorf("startup enable accepts no arguments")
	}
	if cmd.IsSet("executable") && cmd.String("executable") == "" {
		return fmt.Errorf("--executable must not be empty")
	}
	r, err := startupRegistration()
	if err != nil {
		return err
	}
	if runtime.GOOS == "linux" {
		if _, err := exec.LookPath("systemctl"); err != nil {
			return fmt.Errorf("login startup requires systemd: %w", err)
		}
	}
	exe, err := startupExecutable(cmd.String("executable"))
	if err != nil {
		return err
	}
	if err := r.Enable(exe); err != nil {
		return err
	}
	_, err = fmt.Fprintf(cmd.Writer, "Startup enabled for the next login: %s\nExecutable: %s\nUse `otelop start` to start now.\n", r.Path, exe)
	return err
}

func startupDisableCommand() *cli.Command {
	return &cli.Command{
		Name:   "disable",
		Usage:  "Disable startup at future logins",
		Action: runStartupDisable,
	}
}

func runStartupDisable(_ context.Context, cmd *cli.Command) error {
	if cmd.Args().Len() != 0 {
		return fmt.Errorf("startup disable accepts no arguments")
	}
	r, err := startupRegistration()
	if err != nil {
		return err
	}
	if err := r.Disable(); err != nil {
		return err
	}
	_, err = fmt.Fprintln(cmd.Writer, "Startup disabled for future logins. Use `otelop stop` to stop a running server.")
	return err
}

func startupStatusCommand() *cli.Command {
	return &cli.Command{
		Name:   "status",
		Usage:  "Show whether login startup is configured",
		Action: runStartupStatus,
	}
}

func runStartupStatus(_ context.Context, cmd *cli.Command) error {
	if cmd.Args().Len() != 0 {
		return fmt.Errorf("startup status accepts no arguments")
	}
	r, err := startupRegistration()
	if err != nil {
		return err
	}
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

func startupRegistration() (startup.Registration, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return startup.Registration{}, err
	}
	return startup.New(runtime.GOOS, home, os.Getenv("XDG_CONFIG_HOME"), os.Getenv("XDG_DATA_HOME"))
}

func startupExecutable(explicit string) (string, error) {
	if explicit == "" {
		self, _ := os.Executable()
		return detectExecutable(self)
	}
	if !filepath.IsAbs(explicit) {
		return "", fmt.Errorf("--executable must be an absolute path")
	}
	exe, err := exec.LookPath(explicit)
	if err != nil {
		return "", fmt.Errorf("--executable: %w", err)
	}
	return exe, nil
}

func detectExecutable(self string) (string, error) {
	onPath, err := exec.LookPath("otelop")
	if shim := startup.ShimFor([]string{self, onPath}); shim != "" {
		return shim, nil
	}
	return onPath, err
}
