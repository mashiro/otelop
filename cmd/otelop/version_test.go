package main

import (
	"strings"
	"testing"

	"github.com/urfave/cli/v3"
)

func TestVersionCommandKeepsStdoutMachineReadable(t *testing.T) {
	stdout, stderr, err := runTestApp("version")
	if err != nil {
		t.Fatalf("run version: %v", err)
	}
	if stdout != "test-version\n" {
		t.Errorf("stdout = %q, want one version line", stdout)
	}
	if !strings.Contains(stderr, "docs list") {
		t.Errorf("stderr missing docs hint: %q", stderr)
	}
}

func TestVersionFlagKeepsStdoutMachineReadable(t *testing.T) {
	oldPrinter := cli.VersionPrinter
	cli.VersionPrinter = printVersionWithDocsHint
	t.Cleanup(func() { cli.VersionPrinter = oldPrinter })

	stdout, stderr, err := runTestApp("--version")
	if err != nil {
		t.Fatalf("run --version: %v", err)
	}
	if stdout != "otelop version test-version\n" {
		t.Errorf("stdout = %q, want one version line", stdout)
	}
	if !strings.Contains(stderr, "docs list") {
		t.Errorf("stderr missing docs hint: %q", stderr)
	}
}
