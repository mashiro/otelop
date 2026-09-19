// Package docs provides the documentation bundled with the otelop binary.
package docs

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"go.yaml.in/yaml/v3"
)

//go:embed *.md
var files embed.FS

// Document is the metadata shown by `otelop docs list`.
type Document struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// List returns the bundled documents sorted by name.
func List() ([]Document, error) {
	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		return nil, fmt.Errorf("read embedded documentation: %w", err)
	}

	documents := make([]Document, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		raw, err := files.ReadFile(entry.Name())
		if err != nil {
			return nil, fmt.Errorf("read embedded document %q: %w", entry.Name(), err)
		}
		description, _, err := parse(raw)
		if err != nil {
			return nil, fmt.Errorf("parse embedded document %q: %w", entry.Name(), err)
		}
		documents = append(documents, Document{
			Name:        strings.TrimSuffix(entry.Name(), ".md"),
			Description: description,
		})
	}
	sort.Slice(documents, func(i, j int) bool { return documents[i].Name < documents[j].Name })
	return documents, nil
}

// Show returns a document body without its metadata frontmatter.
func Show(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, `/\\`) || strings.HasSuffix(name, ".md") {
		return "", fmt.Errorf("unknown document %q", name)
	}
	raw, err := files.ReadFile(name + ".md")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("unknown document %q", name)
		}
		return "", fmt.Errorf("read embedded document %q: %w", name, err)
	}
	_, body, err := parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse embedded document %q: %w", name, err)
	}
	return body, nil
}

func parse(raw []byte) (string, string, error) {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	const delimiter = "---\n"
	if !strings.HasPrefix(text, delimiter) {
		return "", "", fmt.Errorf("missing YAML frontmatter")
	}
	end := strings.Index(text[len(delimiter):], "\n---\n")
	if end < 0 {
		return "", "", fmt.Errorf("unterminated YAML frontmatter")
	}
	frontmatter := text[len(delimiter) : len(delimiter)+end]
	metadata := struct {
		Description string `yaml:"description"`
	}{}
	decoder := yaml.NewDecoder(strings.NewReader(frontmatter))
	decoder.KnownFields(true)
	if err := decoder.Decode(&metadata); err != nil {
		return "", "", fmt.Errorf("invalid YAML frontmatter: %w", err)
	}
	description := strings.TrimSpace(metadata.Description)
	if description == "" {
		return "", "", fmt.Errorf("missing description in YAML frontmatter")
	}
	bodyStart := len(delimiter) + end + len("\n---\n")
	return description, text[bodyStart:], nil
}
