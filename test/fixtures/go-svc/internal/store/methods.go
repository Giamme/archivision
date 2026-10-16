package store

import "strings"

// Put saves an order.
func (s *Store) Put(o Order) {
	mu.Lock()
	defer mu.Unlock()
	s.orders[strings.TrimSpace(o.ID)] = o
}

// Get finds an order.
func (s *Store) Get(id string) (Order, bool) {
	o, ok := s.orders[id]
	return o, ok
}

func (p Page[T]) Len() int { return len(p.Items) }
