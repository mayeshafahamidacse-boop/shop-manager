import { useState } from 'react'
export const Btn = ({ kind = '', ...p }) => <button className={`btn ${kind}`} {...p} />
export const Field = ({ label, error, ...p }) => (
  <label className="field"><span>{label}</span>
    {p.options ? <select {...p} options={undefined}>{p.options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select> : <input {...p} />}
    {error && <em>{error}</em>}</label>)
export const Modal = ({ title, onClose, children }) => (
  <div className="overlay" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}>
    <header><h3>{title}</h3><Btn kind="ghost" onClick={onClose} aria-label="Close">✕</Btn></header>{children}</div></div>)
export const Table = ({ cols, rows, empty = 'Nothing here yet.' }) => (
  <div className="tablewrap"><table><thead><tr>{cols.map((c) => <th key={c.h} className={c.n ? 'num' : ''}>{c.h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map((r, i) => <tr key={r.id || i}>{cols.map((c) => <td key={c.h} className={c.n ? 'num' : ''}>{c.r(r, i)}</td>)}</tr>)
      : <tr><td colSpan={cols.length} className="muted">{empty}</td></tr>}</tbody></table></div>)
export const Search = (p) => <input className="search" type="search" {...p} />
export function useToast() {
  const [t, set] = useState(null)
  const show = (msg, err) => { set({ msg, err }); setTimeout(() => set(null), 3500) }
  return [t && <div className={`toast ${t.err ? 'err' : ''}`} role="status">{t.msg}</div>, show]
}
