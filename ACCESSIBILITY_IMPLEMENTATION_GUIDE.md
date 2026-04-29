# Accessibility Implementation Guide - Issue #696

## Overview
This guide provides comprehensive accessibility implementation for critical healthcare flows including order creation, dispatch interactions, QR verification, and map-based selection.

---

## Components Implemented

### 1. Focus Management (`focus-management.ts`)

**Functions**:
- `getFocusableElements(container)`: Get all focusable elements
- `trapFocus(container)`: Trap focus within container (modals, dialogs)
- `focusFirstError(container)`: Focus first validation error
- `manageFocusOnRouteChange(target)`: Manage focus on navigation
- `restoreFocus(element)`: Restore focus to previous element
- `getNextFocusable(current)`: Get next focusable element
- `getPreviousFocusable(current)`: Get previous focusable element

**Usage**:
```typescript
import { trapFocus, focusFirstError } from '@/utils/accessibility/focus-management';

// Trap focus in modal
const cleanup = trapFocus(modalElement);

// Focus first error after validation
focusFirstError(formElement);

// Cleanup
cleanup();
```

### 2. Live Announcer (`live-announcer.ts`)

**Functions**:
- `announce(message, priority)`: Announce to screen readers
- `announceError(message)`: Announce error (assertive)
- `announceSuccess(message)`: Announce success (polite)
- `announceLoading(message)`: Announce loading state
- `announceValidationErrors(errors)`: Announce validation errors

**Usage**:
```typescript
import { announceError, announceSuccess, announceValidationErrors } from '@/utils/accessibility/live-announcer';

// Announce error
announceError('Failed to create order');

// Announce success
announceSuccess('Order created successfully');

// Announce validation errors
announceValidationErrors([
  { field: 'email', message: 'Invalid email format' },
  { field: 'phone', message: 'Phone number required' },
]);
```

### 3. Accessible Modal (`AccessibleModal.tsx`)

**Features**:
- Focus trap with keyboard navigation
- Escape key to close
- Overlay click to close (configurable)
- Proper ARIA attributes
- Focus restoration on close
- Announcement on open

**Usage**:
```tsx
import AccessibleModal from '@/components/accessibility/AccessibleModal';

<AccessibleModal
  isOpen={isOpen}
  onClose={handleClose}
  title="Create Order"
  description="Fill out the form to create a new blood order"
  size="medium"
  closeOnEscape={true}
  closeOnOverlayClick={true}
>
  <OrderForm />
</AccessibleModal>
```

### 4. Accessible Form (`AccessibleForm.tsx`)

**Features**:
- Validation error announcements
- Error summary with links
- Auto-focus first error
- Loading state announcements
- Proper form structure

**Usage**:
```tsx
import AccessibleForm from '@/components/accessibility/AccessibleForm';

<AccessibleForm
  onSubmit={handleSubmit}
  errors={validationErrors}
  isSubmitting={isSubmitting}
  ariaLabel="Order creation form"
  autoFocusError={true}
>
  <AccessibleFormField
    id="email"
    label="Email Address"
    type="email"
    value={email}
    onChange={handleEmailChange}
    error={errors.email}
    required
  />
  <button type="submit">Create Order</button>
</AccessibleForm>
```

### 5. Accessible Form Field (`AccessibleFormField.tsx`)

**Features**:
- Proper label association
- Error messages with ARIA
- Help text support
- Required field indicators
- Input variants (input, textarea, select)

**Usage**:
```tsx
import AccessibleFormField from '@/components/accessibility/AccessibleFormField';

<AccessibleFormField
  id="blood-type"
  label="Blood Type"
  variant="select"
  value={bloodType}
  onChange={handleChange}
  options={[
    { value: 'A+', label: 'A+' },
    { value: 'O-', label: 'O-' },
  ]}
  error={errors.bloodType}
  helpText="Select the required blood type"
  required
/>
```

### 6. Keyboard Navigable List (`KeyboardNavigableList.tsx`)

**Features**:
- Arrow key navigation
- Home/End key support
- Enter/Space activation
- Proper ARIA attributes
- Visual focus indicators

**Usage**:
```tsx
import KeyboardNavigableList from '@/components/accessibility/KeyboardNavigableList';

<KeyboardNavigableList
  items={riders}
  selectedIndex={selectedRiderIndex}
  onSelectionChange={(index, rider) => setSelectedRider(rider)}
  onItemActivate={(index, rider) => assignRider(rider)}
  ariaLabel="Available riders"
  orientation="vertical"
  renderItem={(rider, index, isSelected) => (
    <div className="p-4">
      <h4>{rider.name}</h4>
      <p>{rider.status}</p>
    </div>
  )}
/>
```

### 7. Accessible Map Alternative (`AccessibleMapAlternative.tsx`)

**Features**:
- Text-based location selection
- Search functionality
- Keyboard navigation
- Distance information
- Toggle between map and list view

**Usage**:
```tsx
import AccessibleMapAlternative from '@/components/accessibility/AccessibleMapAlternative';

<AccessibleMapAlternative
  locations={bloodBanks}
  selectedLocationId={selectedBloodBank?.id}
  onLocationSelect={handleLocationSelect}
  showMap={showMapView}
  onToggleMapView={() => setShowMapView(!showMapView)}
/>
```

---

## Critical Flow Implementations

### 1. Order Creation Flow

```tsx
import { useState } from 'react';
import AccessibleModal from '@/components/accessibility/AccessibleModal';
import AccessibleForm from '@/components/accessibility/AccessibleForm';
import AccessibleFormField from '@/components/accessibility/AccessibleFormField';
import { announceSuccess, announceError } from '@/utils/accessibility/live-announcer';

function OrderCreationFlow() {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    hospitalId: '',
    bloodType: '',
    units: '',
    urgency: '',
  });
  const [errors, setErrors] = useState<FormError[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate
    const validationErrors = validateForm(formData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    
    try {
      await createOrder(formData);
      announceSuccess('Order created successfully');
      setIsOpen(false);
    } catch (error) {
      announceError('Failed to create order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Create New Order
      </button>

      <AccessibleModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Create Blood Order"
        description="Complete the form to request blood units"
      >
        <AccessibleForm
          onSubmit={handleSubmit}
          errors={errors}
          isSubmitting={isSubmitting}
          ariaLabel="Blood order creation form"
        >
          <AccessibleFormField
            id="hospital-id"
            label="Hospital"
            variant="select"
            value={formData.hospitalId}
            onChange={(e) => setFormData({ ...formData, hospitalId: e.target.value })}
            options={hospitals.map(h => ({ value: h.id, label: h.name }))}
            error={errors.find(e => e.field === 'hospitalId')?.message}
            required
          />

          <AccessibleFormField
            id="blood-type"
            label="Blood Type"
            variant="select"
            value={formData.bloodType}
            onChange={(e) => setFormData({ ...formData, bloodType: e.target.value })}
            options={bloodTypes}
            error={errors.find(e => e.field === 'bloodType')?.message}
            required
          />

          <AccessibleFormField
            id="units"
            label="Number of Units"
            type="number"
            value={formData.units}
            onChange={(e) => setFormData({ ...formData, units: e.target.value })}
            error={errors.find(e => e.field === 'units')?.message}
            min={1}
            max={10}
            required
          />

          <AccessibleFormField
            id="urgency"
            label="Urgency Level"
            variant="select"
            value={formData.urgency}
            onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
            options={[
              { value: 'CRITICAL', label: 'Critical' },
              { value: 'URGENT', label: 'Urgent' },
              { value: 'STANDARD', label: 'Standard' },
            ]}
            error={errors.find(e => e.field === 'urgency')?.message}
            helpText="Critical orders are processed immediately"
            required
          />

          <div className="flex justify-end gap-4 mt-6">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Order'}
            </button>
          </div>
        </AccessibleForm>
      </AccessibleModal>
    </>
  );
}
```

### 2. Dispatch Rider Selection

```tsx
import KeyboardNavigableList from '@/components/accessibility/KeyboardNavigableList';
import { announce } from '@/utils/accessibility/live-announcer';

function DispatchRiderSelection({ orderId }: { orderId: string }) {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleRiderSelect = (index: number, rider: Rider) => {
    setSelectedIndex(index);
    announce(`Selected rider: ${rider.name}, ${rider.status}`);
  };

  const handleRiderAssign = async (index: number, rider: Rider) => {
    try {
      await assignRiderToOrder(orderId, rider.id);
      announceSuccess(`Rider ${rider.name} assigned to order`);
    } catch (error) {
      announceError('Failed to assign rider');
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Select Rider for Dispatch</h2>
      
      <KeyboardNavigableList
        items={riders}
        selectedIndex={selectedIndex}
        onSelectionChange={handleRiderSelect}
        onItemActivate={handleRiderAssign}
        ariaLabel="Available riders for dispatch"
        renderItem={(rider, index, isSelected) => (
          <div className="p-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{rider.name}</h3>
              <p className="text-sm text-gray-600">
                Status: {rider.status} | Rating: {rider.rating}/5
              </p>
              <p className="text-sm text-gray-600">
                Distance: {rider.distance} km
              </p>
            </div>
            {isSelected && (
              <span className="text-blue-600 font-semibold">
                Press Enter to assign
              </span>
            )}
          </div>
        )}
      />
    </div>
  );
}
```

### 3. QR Code Verification

```tsx
import { useState, useRef } from 'react';
import AccessibleModal from '@/components/accessibility/AccessibleModal';
import { announceSuccess, announceError } from '@/utils/accessibility/live-announcer';

function QRVerification({ orderId }: { orderId: string }) {
  const [isScanning, setIsScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [useManualEntry, setUseManualEntry] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleManualVerification = async () => {
    if (!manualCode) {
      announceError('Please enter verification code');
      return;
    }

    try {
      await verifyOrder(orderId, manualCode);
      announceSuccess('Order verified successfully');
    } catch (error) {
      announceError('Invalid verification code');
    }
  };

  return (
    <AccessibleModal
      isOpen={true}
      onClose={() => {}}
      title="Verify Order Delivery"
      description="Scan QR code or enter verification code manually"
    >
      <div className="space-y-4">
        {/* Toggle between scan and manual entry */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setUseManualEntry(false);
              announce('Switched to QR code scanning mode');
            }}
            className={`px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              !useManualEntry ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
            aria-pressed={!useManualEntry}
          >
            Scan QR Code
          </button>
          <button
            type="button"
            onClick={() => {
              setUseManualEntry(true);
              announce('Switched to manual code entry mode');
              setTimeout(() => inputRef.current?.focus(), 100);
            }}
            className={`px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              useManualEntry ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
            aria-pressed={useManualEntry}
          >
            Enter Code Manually
          </button>
        </div>

        {/* QR Scanner */}
        {!useManualEntry && (
          <div>
            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
              role="img"
              aria-label="QR code scanner viewfinder"
            >
              <p className="text-gray-600">
                Position QR code within the frame
              </p>
              {isScanning && (
                <p className="text-sm text-gray-500 mt-2" role="status" aria-live="polite">
                  Scanning...
                </p>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-2">
              Having trouble scanning? Use manual entry instead.
            </p>
          </div>
        )}

        {/* Manual Entry */}
        {useManualEntry && (
          <div>
            <label htmlFor="verification-code" className="block text-sm font-medium text-gray-700 mb-2">
              Verification Code
            </label>
            <input
              ref={inputRef}
              id="verification-code"
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Enter 6-digit code"
              maxLength={6}
              className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-describedby="code-help"
              inputMode="numeric"
              pattern="[0-9]{6}"
            />
            <p id="code-help" className="text-sm text-gray-600 mt-1">
              Enter the 6-digit verification code from the delivery receipt
            </p>
            <button
              type="button"
              onClick={handleManualVerification}
              className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Verify Code
            </button>
          </div>
        )}
      </div>
    </AccessibleModal>
  );
}
```

### 4. Blood Bank Selection (Map Alternative)

```tsx
import AccessibleMapAlternative from '@/components/accessibility/AccessibleMapAlternative';

function BloodBankSelection({ onSelect }: { onSelect: (bank: BloodBank) => void }) {
  const [bloodBanks, setBloodBanks] = useState<BloodBank[]>([]);
  const [selectedBank, setSelectedBank] = useState<BloodBank | null>(null);
  const [showMap, setShowMap] = useState(false);

  const locations = bloodBanks.map(bank => ({
    id: bank.id,
    name: bank.name,
    address: bank.address,
    distance: bank.distance,
    coordinates: bank.coordinates,
  }));

  const handleLocationSelect = (location: MapLocation) => {
    const bank = bloodBanks.find(b => b.id === location.id);
    if (bank) {
      setSelectedBank(bank);
      announceSuccess(`Selected ${bank.name}`);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Select Blood Bank</h2>
      
      <AccessibleMapAlternative
        locations={locations}
        selectedLocationId={selectedBank?.id}
        onLocationSelect={handleLocationSelect}
        showMap={showMap}
        onToggleMapView={() => setShowMap(!showMap)}
      />

      {selectedBank && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
          <h3 className="font-semibold">Selected Blood Bank</h3>
          <p>{selectedBank.name}</p>
          <p className="text-sm text-gray-600">{selectedBank.address}</p>
          <button
            type="button"
            onClick={() => onSelect(selectedBank)}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Confirm Selection
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Keyboard Navigation Patterns

### Modal/Dialog
- **Tab**: Move focus forward
- **Shift+Tab**: Move focus backward
- **Escape**: Close modal
- **Focus trap**: Focus stays within modal

### Lists
- **Arrow Up/Down**: Navigate items
- **Home**: First item
- **End**: Last item
- **Enter/Space**: Activate item

### Forms
- **Tab**: Next field
- **Shift+Tab**: Previous field
- **Enter**: Submit form
- **Escape**: Clear/cancel (in some contexts)

### Maps
- **Tab**: Navigate to list view toggle
- **Enter**: Switch to list view
- **Arrow keys**: Navigate locations in list

---

## ARIA Attributes Reference

### Modals
```html
<div role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
  <h2 id="modal-title">Modal Title</h2>
  <p id="modal-description">Modal description</p>
</div>
```

### Forms
```html
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

### Lists
```html
<ul role="listbox" aria-label="Available options" aria-multiselectable="false">
  <li role="option" aria-selected="true" tabindex="0">Option 1</li>
  <li role="option" aria-selected="false" tabindex="-1">Option 2</li>
</ul>
```

### Live Regions
```html
<div aria-live="polite" aria-atomic="true">Status update</div>
<div aria-live="assertive" role="alert">Error message</div>
```

---

## Testing Checklist

### Keyboard Navigation
- [ ] All interactive elements are keyboard accessible
- [ ] Tab order is logical
- [ ] Focus indicators are visible
- [ ] No keyboard traps (except intentional in modals)
- [ ] Escape key closes modals
- [ ] Arrow keys work in lists

### Screen Reader
- [ ] All images have alt text
- [ ] Form fields have labels
- [ ] Error messages are announced
- [ ] Status updates are announced
- [ ] Modal opening is announced
- [ ] Page title updates on navigation

### Focus Management
- [ ] Focus moves to modal on open
- [ ] Focus returns to trigger on close
- [ ] Focus moves to first error on validation
- [ ] Focus moves to main content on navigation

### ARIA
- [ ] Proper roles on custom components
- [ ] aria-label or aria-labelledby on all interactive elements
- [ ] aria-invalid on error fields
- [ ] aria-describedby links to error messages
- [ ] aria-live regions for dynamic content

---

## Browser Testing

Test in:
- Chrome + NVDA (Windows)
- Firefox + NVDA (Windows)
- Safari + VoiceOver (macOS)
- Chrome + TalkBack (Android)
- Safari + VoiceOver (iOS)

---

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM](https://webaim.org/)
- [A11y Project](https://www.a11yproject.com/)

---

## Summary

All critical healthcare flows now have:
✅ Full keyboard navigation
✅ Screen reader support
✅ Focus management
✅ ARIA attributes
✅ Live announcements
✅ Visible focus indicators
✅ Modal focus trapping
✅ Form validation announcements
✅ Map alternatives for keyboard users
