import type { Field } from '../lib/types';
import { Input, Label, Toggle, inputCls, cx } from './ui';

export function FieldInput({ field: f, value, onChange, compact }: { field: Field; value: any; onChange: (v: any) => void; compact?: boolean }) {
  const label = <span className="text-xs font-medium text-muted">{f.label}{f.required && <span className="text-bad"> *</span>}</span>;
  if (f.type === 'boolean') return <div className={cx(!compact && 'py-1')}><Toggle checked={!!value} onChange={onChange} label={<span className="text-sm">{f.label}</span>} /></div>;
  let control;
  if (f.type === 'select')
    control = (
      <select className={inputCls} value={value ?? f.default ?? ''} onChange={(e) => onChange(e.target.value)}>
        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  else if (f.type === 'text')
    control = <textarea className={cx(inputCls, 'h-28 py-2 font-mono text-xs')} value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  else if (f.type === 'secret')
    control = (
      <Input type="password" autoComplete="new-password" value={value === '__unchanged__' ? '' : value ?? ''} placeholder={value === '__unchanged__' ? '•••••••• (spremljeno, ostavi prazno)' : f.placeholder}
        onChange={(e) => onChange(e.target.value === '' && value === '__unchanged__' ? '__unchanged__' : e.target.value)} />
    );
  else
    control = <Input type={f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'} value={value ?? ''} placeholder={f.placeholder} onChange={(e) => onChange(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
  return <Label help={compact ? undefined : f.help}>{label}{control}</Label>;
}
