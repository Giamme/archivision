package main

import (
	"fmt"
	"net/http"

	"example.com/gosvc/internal/api"
	"example.com/gosvc/internal/store"
)

// main wires the store into the API and serves it.
func main() {
	s := store.New()
	h := api.NewHandler(s)
	http.HandleFunc("/orders", h.Orders)
	fmt.Println("listening")
	_ = http.ListenAndServe(":8080", nil)
}

func init() {
	fmt.Println("one")
}

func init() {
	fmt.Println("two")
}
