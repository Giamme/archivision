package main

import "strings"

type Store struct{ items []string }

func NewStore() *Store {
	return &Store{}
}

func (s *Store) Add(x string) {
	s.items = append(s.items, clean(x)) // CALL go/store.go#Store.Add -> go/store.go#clean
}

func (s *Store) Items() []string {
	return s.items
}

func (s *Store) Read() string {
	return strings.Join(s.items, ",")
}

func clean(x string) string {
	return strings.TrimSpace(x)
}
