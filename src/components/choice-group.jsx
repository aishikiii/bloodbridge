export function ChoiceGroup({ label, name, values, defaultValue, description }) {
  return <fieldset className="choice-field">
    <legend>{label}</legend>
    <div className="choice-grid">
      {values.map(value => {
        const [raw, shown] = Array.isArray(value) ? value : [value, value]
        return <label key={raw}><input type="radio" name={name} value={raw} defaultChecked={String(raw) === String(defaultValue)} /><span>{shown}</span></label>
      })}
    </div>
    {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
  </fieldset>
}
