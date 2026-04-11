package graphql

import "fmt"

// JSONMap is the Go representation of the schema's `JSON` scalar. It carries
// arbitrary key/value data — used for span/log attributes and resource maps —
// and relies on encoding/json to marshal the underlying map as-is.
type JSONMap map[string]any

// ImplementsGraphQLType satisfies the graph-gophers/graphql-go custom-scalar
// contract by claiming the `JSON` scalar name.
func (JSONMap) ImplementsGraphQLType(name string) bool { return name == "JSON" }

// UnmarshalGraphQL accepts JSON object literals passed as variables.
func (j *JSONMap) UnmarshalGraphQL(input any) error {
	m, ok := input.(map[string]any)
	if !ok {
		return fmt.Errorf("JSON scalar: expected object, got %T", input)
	}
	*j = m
	return nil
}
