package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	otelopdocs "github.com/mashiro/otelop/docs"
)

func TestDocsListCommand(t *testing.T) {
	command := docsCommand().Commands[0]
	var output bytes.Buffer
	command.Writer = &output
	if err := command.Run(context.Background(), []string{"list"}); err != nil {
		t.Fatalf("run docs list: %v", err)
	}
	for _, want := range []string{"configuration", "getting-started", "docs show <name>"} {
		if !strings.Contains(output.String(), want) {
			t.Errorf("plain-text output missing %q:\n%s", want, output.String())
		}
	}
	if json.Valid(output.Bytes()) {
		t.Fatalf("default output is JSON, want plain text:\n%s", output.String())
	}
}

func TestDocsListCommandJSON(t *testing.T) {
	command := docsCommand().Commands[0]
	var output bytes.Buffer
	command.Writer = &output
	if err := command.Run(context.Background(), []string{"list", "--json"}); err != nil {
		t.Fatalf("run docs list --json: %v", err)
	}
	var result struct {
		Results []otelopdocs.Document `json:"results"`
		Help    string                `json:"help"`
	}
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatalf("decode output: %v\n%s", err, output.String())
	}
	if len(result.Results) == 0 || !strings.Contains(result.Help, "docs show") {
		t.Fatalf("unexpected output: %#v", result)
	}
}

func TestDocsShowCommand(t *testing.T) {
	command := docsCommand().Commands[1]
	var output bytes.Buffer
	command.Writer = &output
	if err := command.Run(context.Background(), []string{"show", "getting-started"}); err != nil {
		t.Fatalf("run docs show: %v", err)
	}
	if !strings.HasPrefix(output.String(), "# Getting started") {
		t.Fatalf("unexpected output: %q", output.String())
	}
}

func TestDocsShowCommandRequiresKnownName(t *testing.T) {
	for _, args := range [][]string{{"show"}, {"show", "missing"}} {
		command := docsCommand().Commands[1]
		if err := command.Run(context.Background(), args); err == nil || !strings.Contains(err.Error(), "docs list") {
			t.Errorf("run %v returned %v, want error with docs list hint", args, err)
		}
	}
}

func TestDocsCommandsRejectExtraArguments(t *testing.T) {
	for _, args := range [][]string{
		{"docs", "list", "unexpected"},
		{"docs", "show", "getting-started", "unexpected"},
	} {
		_, _, err := runTestApp(args...)
		if err == nil {
			t.Errorf("otelop %v succeeded, want argument error", args)
		}
	}
}

func runTestApp(args ...string) (stdout, stderr string, err error) {
	app := newApp("test-version")
	var out, errOut bytes.Buffer
	app.Writer = &out
	app.ErrWriter = &errOut
	err = app.Run(context.Background(), append([]string{"otelop"}, args...))
	return out.String(), errOut.String(), err
}
