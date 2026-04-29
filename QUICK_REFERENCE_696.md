# Quick Reference - Accessibility Components (#696)

## 🚀 Quick Start

### Import Components
```typescript
// Focus Management
import { trapFocus, focusFirstError } from '@/utils/accessibility/focus-management';

// Live Announcer
import { announce, announceError, announceSuccess } from '@/utils/accessibility/live-announcer';

// Components
import AccessibleModal from '@/components/accessibility/AccessibleModal';
import AccessibleForm from '@/components/accessibility/AccessibleForm';
import AccessibleFormField from '@/components/accessibility/AccessibleFormField';
import KeyboardNavigableList from '@/components/accessibility/KeyboardNavigableList';
import AccessibleMapAlternative from '@/components/accessibility/AccessibleMapAlternative';
```

---

## 📦 Components

### AccessibleModal
```tsx
<AccessibleModal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Modal Title"
  description="Modal description for screen readers"
  size="medium" // small | medium | large | fullscreen
  closeOnEscape={true}
  closeOnOverlayClick={true}
>
  {/* Modal content */}
</AccessibleModal>
```

### AccessibleForm
```tsx
<AccessibleForm
  onSubmit={handleSubmit}
  errors={[
    { field: 'email', message: 'Invalid email' },
    { field: 'password', message: 'Password required' }
  ]}
  isSubmitting={isSubmitting}
  ariaLabel="Login form"
  autoFocusError={true}
>
  {/* Form fields */}
</AccessibleForm>
```

### AccessibleFormField
```tsx
// Input
<AccessibleFormField
  id="email"
  label="Email Address"
  type="email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={errors.email}
  helpText="We'll never share your email"
  required
/>

// Select
<AccessibleFormField
  id="blood-type"
  label="Blood Type"
  variant="select"
  value={bloodType}
  onChange={(e) => setBloodType(e.target.value)}
  options={[
    { value: 'A+', label: 'A+' },
    { value: 'O-', label: 'O-' }
  ]}
  required
/>

// Textarea
<AccessibleFormField
  id="notes"
  label="Notes"
  variant="textarea"
  value={notes}
  onChange={(e) => setNotes(e.target.value)}
  rows={4}
/>
```

### KeyboardNavigableList
```tsx
<KeyboardNavigableList
  items={riders}
  selectedIndex={selectedIndex}
  onSelectionChange={(index, rider) => setSelectedIndex(index)}
  onItemActivate={(index, rider) => assignRider(rider)}
  ariaLabel="Available riders"
  orientation="vertical" // vertical | horizontal
  renderItem={(rider, index, isSelected) => (
    <div className={isSelected ? 'bg-blue-100' : ''}>
      <h4>{rider.name}</h4>
      <p>{rider.status}</p>
    </div>
  )}
/>
```

### AccessibleMapAlternative
```tsx
<AccessibleMapAlternative
  locations={[
    {
      id: '1',
      name: 'Blood Bank A',
      address: '123 Main St',
      distance: 2.5,
      coordinates: { lat: 40.7128, lng: -74.0060 }
    }
  ]}
  selectedLocationId={selectedId}
  onLocationSelect={(location) => setSelectedId(location.id)}
  showMap={showMap}
  onToggleMapView={() => setShowMap(!showMap)}
/>
```

---

## 🔧 Utilities

### Focus Management
```typescript
// Trap focus in modal
const cleanup = trapFocus(modalElement);
// Later: cleanup();

// Focus first error
focusFirstError(formElement);

// Manage focus on navigation
manageFocusOnRouteChange(mainElement);

// Restore focus
restoreFocus(previousElement);

// Get next/previous focusable
const next = getNextFocusable(currentElement);
const prev = getPreviousFocusable(currentElement);
```

### Live Announcer
```typescript
// General announcement
announce('Order created', AnnouncementPriority.POLITE);

// Error (assertive)
announceError('Failed to create order');

// Success (polite)
announceSuccess('Order created successfully');

// Loading
announceLoading('Loading orders...');

// Validation errors
announceValidationErrors([
  { field: 'email', message: 'Invalid email' },
  { field: 'password', message: 'Password required' }
]);

// Status
announceStatus('Processing...', AnnouncementPriority.POLITE);
```

---

## 🎨 CSS Utilities

### Screen Reader Only
```html
<span className="sr-only">Hidden from visual users</span>
<a href="#main" className="skip-to-main">Skip to main content</a>
```

### Focus Indicators
```html
<button className="focus:ring-2 focus:ring-blue-500">
  Click me
</button>

<div className="focus-within:ring-2">
  <input type="text" />
</div>
```

### Touch Targets
```html
<button className="touch-target">
  Small icon button
</button>
```

### Required Fields
```html
<label className="required-indicator">
  Email Address
</label>
```

---

## ⌨️ Keyboard Shortcuts

### Modals
- **Tab** - Next element
- **Shift+Tab** - Previous element
- **Escape** - Close modal

### Lists
- **↑/↓** - Navigate items (vertical)
- **←/→** - Navigate items (horizontal)
- **Home** - First item
- **End** - Last item
- **Enter** - Activate item
- **Space** - Activate item

### Forms
- **Tab** - Next field
- **Shift+Tab** - Previous field
- **Enter** - Submit form

---

## 🏷️ ARIA Patterns

### Modal
```html
<div role="dialog" aria-modal="true" aria-labelledby="title" aria-describedby="desc">
  <h2 id="title">Title</h2>
  <p id="desc">Description</p>
</div>
```

### Form Field
```html
<label for="email">Email</label>
<input
  id="email"
  type="email"
  aria-invalid="true"
  aria-describedby="email-error email-help"
  aria-required="true"
/>
<p id="email-help">Help text</p>
<p id="email-error" role="alert">Error message</p>
```

### List
```html
<ul role="listbox" aria-label="Options">
  <li role="option" aria-selected="true" tabindex="0">Option 1</li>
  <li role="option" aria-selected="false" tabindex="-1">Option 2</li>
</ul>
```

### Live Region
```html
<div aria-live="polite" aria-atomic="true">Status update</div>
<div aria-live="assertive" role="alert">Error!</div>
```

---

## 📋 Common Patterns

### Order Creation Modal
```tsx
function OrderCreation() {
  const [isOpen, setIsOpen] = useState(false);
  const [errors, setErrors] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createOrder(formData);
      announceSuccess('Order created');
      setIsOpen(false);
    } catch (error) {
      announceError('Failed to create order');
    }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Create Order</button>
      <AccessibleModal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Create Order">
        <AccessibleForm onSubmit={handleSubmit} errors={errors}>
          <AccessibleFormField id="hospital" label="Hospital" required />
          <button type="submit">Create</button>
        </AccessibleForm>
      </AccessibleModal>
    </>
  );
}
```

### Rider Selection List
```tsx
function RiderSelection({ onSelect }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <KeyboardNavigableList
      items={riders}
      selectedIndex={selectedIndex}
      onSelectionChange={(index) => setSelectedIndex(index)}
      onItemActivate={(index, rider) => {
        onSelect(rider);
        announceSuccess(`Selected ${rider.name}`);
      }}
      ariaLabel="Available riders"
      renderItem={(rider, index, isSelected) => (
        <div className={isSelected ? 'bg-blue-100' : ''}>
          <h4>{rider.name}</h4>
          <p>{rider.status}</p>
        </div>
      )}
    />
  );
}
```

### QR Verification with Manual Entry
```tsx
function QRVerification() {
  const [useManual, setUseManual] = useState(false);
  const [code, setCode] = useState('');

  const handleVerify = async () => {
    try {
      await verifyCode(code);
      announceSuccess('Verified successfully');
    } catch (error) {
      announceError('Invalid code');
    }
  };

  return (
    <AccessibleModal isOpen={true} onClose={() => {}} title="Verify Order">
      <div>
        <button
          onClick={() => {
            setUseManual(false);
            announce('Switched to QR scanning');
          }}
          aria-pressed={!useManual}
        >
          Scan QR
        </button>
        <button
          onClick={() => {
            setUseManual(true);
            announce('Switched to manual entry');
          }}
          aria-pressed={useManual}
        >
          Manual Entry
        </button>

        {useManual && (
          <div>
            <AccessibleFormField
              id="code"
              label="Verification Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              helpText="Enter 6-digit code"
            />
            <button onClick={handleVerify}>Verify</button>
          </div>
        )}
      </div>
    </AccessibleModal>
  );
}
```

---

## ✅ Testing Checklist

### Keyboard
- [ ] Tab through all interactive elements
- [ ] Shift+Tab works in reverse
- [ ] Enter activates buttons/links
- [ ] Escape closes modals
- [ ] Arrow keys navigate lists
- [ ] No keyboard traps

### Screen Reader
- [ ] All images have alt text
- [ ] Form fields have labels
- [ ] Errors are announced
- [ ] Status updates are announced
- [ ] Modal opening is announced

### Focus
- [ ] Focus visible on all elements
- [ ] Focus trapped in modals
- [ ] Focus restored on modal close
- [ ] Focus moves to first error

### ARIA
- [ ] Proper roles on components
- [ ] aria-label on interactive elements
- [ ] aria-invalid on error fields
- [ ] aria-describedby links to errors
- [ ] aria-live for dynamic content

---

## 🔗 Resources

- [Full Implementation Guide](./ACCESSIBILITY_IMPLEMENTATION_GUIDE.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY_696.md)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Practices](https://www.w3.org/WAI/ARIA/apg/)

---

## 💡 Tips

1. **Always provide labels** - Every form field needs a label
2. **Announce changes** - Use live announcer for dynamic updates
3. **Test with keyboard** - Tab through your entire flow
4. **Use semantic HTML** - Prefer `<button>` over `<div onClick>`
5. **Focus management** - Manage focus on navigation and errors
6. **Error messages** - Link errors to fields with `aria-describedby`
7. **Loading states** - Announce loading and completion
8. **Modal focus** - Trap focus and restore on close

---

**Issue**: #696  
**Status**: ✅ COMPLETED  
**Date**: 2026-04-29
