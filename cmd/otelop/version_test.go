package main

import (
	"testing"
)

func TestVersionCommandKeepsStdoutMachineReadable(t *testing.T) {
	stdout, stderr, err := runTestApp("version")
	if err != nil {
		t.Fatalf("run version: %v", err)
	}
	if stdout != "test-version\n" {
		t.Errorf("stdout = %q, want one version line", stdout)
	}
	if stderr != "" {
		t.Errorf("stderr = %q, want no output", stderr)
	}
}

func TestVersionFlagKeepsStdoutMachineReadable(t *testing.T) {
	stdout, stderr, err := runTestApp("--version")
	if err != nil {
		t.Fatalf("run --version: %v", err)
	}
	if stdout != "otelop version test-version\n" {
		t.Errorf("stdout = %q, want one version line", stdout)
	}
	if stderr != "" {
		t.Errorf("stderr = %q, want no output", stderr)
	}
}
