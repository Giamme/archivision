package api

import (
	"encoding/json"
	"net/http"

	"example.com/gosvc/internal/store"
)

// Saver is what the handler needs from a store.
type Saver interface {
	Put(o store.Order)
	Get(id string) (store.Order, bool)
}

// Handler serves orders.
type Handler struct{ s Saver }

// NewHandler makes a handler.
func NewHandler(s Saver) *Handler { return &Handler{s: s} }

// Orders handles /orders.
func (h *Handler) Orders(w http.ResponseWriter, r *http.Request) {
	var o store.Order
	if err := json.NewDecoder(r.Body).Decode(&o); err != nil {
		http.Error(w, "bad order", http.StatusBadRequest)
		return
	}
	h.s.Put(o)
	w.WriteHeader(http.StatusCreated)
}
