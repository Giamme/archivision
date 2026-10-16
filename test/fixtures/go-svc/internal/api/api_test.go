package api

import "testing"

func TestNewHandler(t *testing.T) {
	if NewHandler(nil) == nil {
		t.Fatal("no handler")
	}
}
