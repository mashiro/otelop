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
		<key>WorkingDirectory</key>
		<string>{{xml .WorkingDirectory}}</string>
		<key>RunAtLoad</key>
		<true/>
		<key>AbandonProcessGroup</key>
		<true/>
		<key>EnvironmentVariables</key>
		<dict>
{{range .Environment}}			<key>{{xml .Key}}</key>
			<string>{{xml .Value}}</string>
{{end}}		</dict>
	</dict>
</plist>
`

const systemdUnitSource = `[Unit]
Description=Start otelop at user login

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory={{unitPath .WorkingDirectory}}
ExecStart={{unitExecutable .Executable}} start
{{range .Environment}}Environment={{unitQuote .Pair}}
{{end}}
[Install]
WantedBy=default.target
`

var (
	launchAgentTemplate = template.Must(template.New("launch-agent").Funcs(template.FuncMap{
		"xml": xmlText,
	}).Parse(launchAgentSource))
	systemdUnitTemplate = template.Must(template.New("systemd-unit").Funcs(template.FuncMap{
		"unitPath":       unitPath,
		"unitExecutable": unitExecutable,
		"unitQuote":      unitQuote,
	}).Parse(systemdUnitSource))
)

type templateEnvironment struct {
	Key   string
	Value string
	Pair  string
}

type registrationTemplateData struct {
	Label            string
	Executable       string
	WorkingDirectory string
	Environment      []templateEnvironment
}

func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// WorkingDirectory is a literal path, not a quoted word list like ExecStart.
// Only systemd specifiers need escaping; quotes and backslashes are literal.
func unitPath(s string) string {
	return strings.ReplaceAll(s, "%", "%%")
}

func unitQuote(s string) string {
	return strconv.Quote(unitPath(s))
}

func unitExecutable(s string) string {
	return unitQuote(strings.ReplaceAll(s, "$", "$$"))
}

func (r Registration) render(opts Options) (string, error) {
	data := registrationTemplateData{
		Label:            label,
		Executable:       opts.Executable,
		WorkingDirectory: opts.WorkingDirectory,
	}
	for _, pair := range environmentPairs(opts.Environment) {
		key, value, _ := strings.Cut(pair, "=")
		data.Environment = append(data.Environment, templateEnvironment{Key: key, Value: value, Pair: pair})
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
