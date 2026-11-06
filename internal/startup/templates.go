package startup

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
	"text/template"
)

const launchAgentSource = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
	<dict>
		<key>Label</key>
		<string>{{xml .Label}}</string>
		<key>ProgramArguments</key>
		<array>
			<string>{{xml .Executable}}</string>
			<string>start</string>
		</array>
		<key>RunAtLoad</key>
		<true/>
		<key>AbandonProcessGroup</key>
		<true/>
	</dict>
</plist>
`

const launcherWrapperSource = `#!/bin/sh
exec {{shellQuote .Executable}} "$@"
`

const systemdUnitSource = `[Unit]
Description=Start otelop at user login

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart={{unitExecutable .Executable}} start

[Install]
WantedBy=default.target
`

var (
	launchAgentTemplate = template.Must(template.New("launch-agent").Funcs(template.FuncMap{
		"xml": xmlText,
	}).Parse(launchAgentSource))
	launcherWrapperTemplate = template.Must(template.New("launcher-wrapper").Funcs(template.FuncMap{
		"shellQuote": shellQuote,
	}).Parse(launcherWrapperSource))
	systemdUnitTemplate = template.Must(template.New("systemd-unit").Funcs(template.FuncMap{
		"unitExecutable": unitExecutable,
	}).Parse(systemdUnitSource))
)

type registrationTemplateData struct {
	Label      string
	Executable string
}

func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func unitExecutable(s string) string {
	return strconv.Quote(strings.NewReplacer("%", "%%", "$", "$$").Replace(s))
}

func (r Registration) render(executable string) (string, error) {
	data := registrationTemplateData{
		Label:      label,
		Executable: executable,
	}

	tmpl := systemdUnitTemplate
	if r.platform == "darwin" {
		tmpl = launchAgentTemplate
	}
	var b strings.Builder
	if err := tmpl.Execute(&b, data); err != nil {
		return "", fmt.Errorf("render startup registration: %w", err)
	}
	return b.String(), nil
}

func renderLauncherWrapper(executable string) (string, error) {
	var b strings.Builder
	if err := launcherWrapperTemplate.Execute(&b, registrationTemplateData{Executable: executable}); err != nil {
		return "", fmt.Errorf("render launcher wrapper: %w", err)
	}
	return b.String(), nil
}
