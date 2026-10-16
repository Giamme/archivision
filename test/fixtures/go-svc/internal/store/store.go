package store

import "sync"

// Order is one order.
type Order struct {
	ID    string
	Total int // in cents; a } in a comment ends nothing
}

type (
	// ID names an order.
	ID string
	// Page is one page of results.
	Page[T any] struct {
		Items []T
		Next  string
	}
)

const (
	MaxPage = 100
	minPage = 1
	A, B    = "a{", "b}"
)

var (
	mu      sync.Mutex
	_       = sync.Once{}
	Default = New()
)

const banner = `multi
line { raw
string`

// Store keeps orders in memory.
type Store struct {
	orders map[string]Order
}

// New makes an empty store.
func New() *Store {
	return &Store{orders: map[string]Order{}}
}
