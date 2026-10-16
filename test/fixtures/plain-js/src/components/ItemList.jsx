export function ItemRow({ item }) {
  return <li>{item.name} · {item.label}</li>;
}

export default function ItemList({ items }) {
  return <ul>{items.map(i => <ItemRow key={i.id} item={i} />)}</ul>;
}
