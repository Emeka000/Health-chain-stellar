# Accessibility & Localization Guidelines

## Overview

This document provides guidelines for implementing and maintaining accessibility and localization throughout the Health Chain application. All developers should follow these guidelines to ensure the application is usable by everyone, regardless of ability or language.

## Table of Contents

1. [Accessibility (A11y) Guidelines](#accessibility-guidelines)
2. [Localization (i18n) Guidelines](#localization-guidelines)
3. [Implementation Checklist](#implementation-checklist)
4. [Testing & Validation](#testing--validation)

---

## Accessibility Guidelines

### 1. Keyboard Navigation

All interactive elements must be keyboard accessible.

#### Requirements

- **All clickable elements must be focusable**: buttons, links, form fields
- **Focus indicators must be visible**: Use `focus:ring-2 focus:ring-blue-500` styling
- **Tab order must be logical**: Left to right, top to bottom
- **No keyboard traps**: Users must be able to navigate away from any element

#### Implementation

Use provided accessible form components:

```tsx
import { AccessibleInput, AccessibleButton } from '@/components/forms/AccessibleFormFields';

export function MyForm() {
  return (
    <form>
      <AccessibleInput
        label="Email"
        type="email"
        required
      />
      <AccessibleButton variant="primary">
        Submit
      </AccessibleButton>
    </form>
  );
}
```

#### Keyboard Shortcuts

- **Tab**: Move focus to next element
- **Shift+Tab**: Move focus to previous element
- **Enter**: Activate button or submit form
- **Escape**: Close modal/cancel action
- **Arrow Keys**: Navigate within custom controls (selects, tabs, lists)
- **Home/End**: Jump to first/last item in lists

### 2. Screen Reader Support

All content must be accessible to screen reader users.

#### ARIA Attributes

```tsx
// Form fields
<input
  aria-label="Full Name"
  aria-required="true"
  aria-invalid={hasError}
  aria-describedby="error-message-id"
/>

// Live regions for dynamic updates
<div role="status" aria-live="polite" aria-atomic="true">
  Processing your request...
</div>

// Buttons with icons
<button aria-label="Close modal">
  <XIcon />
</button>

// Form validation errors
<div role="alert">
  Please check the errors below
</div>
```

#### Form Labels

Always associate labels with form inputs:

```tsx
<label htmlFor="email">Email Address</label>
<input id="email" type="email" />
```

#### Skip Links

Include skip links to bypass navigation:

```tsx
import { SkipLink } from '@/components/accessibility/AccessibleComponents';

export function Layout() {
  return (
    <>
      <SkipLink href="#main-content" />
      <nav>Navigation</nav>
      <main id="main-content">Content</main>
    </>
  );
}
```

### 3. Visual Accessibility

#### Color Contrast

- **Normal text**: 4.5:1 contrast ratio minimum (WCAG AA)
- **Large text** (18pt+): 3:1 contrast ratio minimum
- **UI components**: 3:1 contrast ratio minimum

**Don't rely on color alone** — use text labels, icons, and patterns.

#### Focus Management

```tsx
import { useFocusManagement } from '@/lib/useFocusManagement';

export function MultiStepForm() {
  const { containerRef, setFocusToElement, setFocusToError } = useFocusManagement();

  const handleError = () => {
    setFocusToError(); // Focus first error message
  };

  return <div ref={containerRef}>{/* form content */}</div>;
}
```

#### Focus Rings

All components use visible focus rings:

```tsx
// Tailwind CSS
className="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
```

### 4. Semantic HTML

Use semantic elements for structure:

```tsx
// Good
<header>
  <h1>Page Title</h1>
</header>
<main role="main">
  <article>
    <h2>Article Title</h2>
  </article>
</main>
<footer>Footer content</footer>

// Avoid
<div class="header">
  <div class="heading">Page Title</div>
</div>
<div class="main">
  <div>Article Title</div>
</div>
```

#### Heading Hierarchy

- Use `<h1>` for page title (only one per page)
- Use `<h2>`, `<h3>`, etc. in order
- Don't skip heading levels (e.g., `<h1>` → `<h3>` is bad)

```tsx
<h1>Page Title</h1>
<section>
  <h2>Section One</h2>
  <h3>Subsection</h3>
  <p>Content...</p>
</section>
```

### 5. Error Handling

Errors must be clear and actionable:

```tsx
import { FormValidationErrors } from '@/components/forms/AccessibleForm';

export function Form() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <>
      <FormValidationErrors errors={errors} />
      {/* form fields */}
    </>
  );
}
```

Error messages should:
- Be specific about what went wrong
- Suggest how to fix it
- Use clear, non-technical language
- Be announced to screen reader users

### 6. Testing Accessibility

Use provided testing utilities:

```tsx
import {
  testKeyboardNavigation,
  testFormLabels,
  testSemanticStructure,
} from '@/lib/testA11y';

describe('BloodOrderForm', () => {
  it('should be keyboard navigable', async () => {
    await testKeyboardNavigation(
      <BloodOrderForm />,
      ['#blood-type-select', '#quantity-input', '#submit-button']
    );
  });

  it('should have proper labels', () => {
    testFormLabels(<BloodOrderForm />);
  });
});
```

---

## Localization Guidelines

### 1. Translation Structure

All UI text must be externalized to translation files:

```
public/locales/
├── en/
│   ├── common.json        # Common/shared strings
│   ├── forms.json         # Form-related strings
│   ├── orders.json        # Order workflow strings
│   ├── dispatch.json      # Dispatch workflow strings
│   ├── verification.json  # Verification workflow strings
│   └── errors.json        # Error messages
└── fr/
    ├── common.json
    ├── forms.json
    ... (same structure)
```

### 2. Translation Keys

Use consistent, hierarchical key naming:

```
Category_Subcategory_Item
Examples:
- form_required_field
- order_blood_type_label
- dispatch_status_in_transit
- error_404
```

### 3. Using Translations in Components

```tsx
import { useTranslation } from 'react-i18next';

export function BloodOrderForm() {
  const { t } = useTranslation(['orders', 'forms']);

  return (
    <div>
      <label>{t('orders:order_blood_type_label')}</label>
      <select required aria-required="true">
        <option value="A+">{t('orders:order_blood_type_a')}</option>
      </select>
      {error && <p>{t('forms:form_required_field')}</p>}
    </div>
  );
}
```

### 4. Language Switching

Use the provided language switcher:

```tsx
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function Header() {
  return (
    <header>
      <nav>Navigation items</nav>
      <LanguageSwitcher />
    </header>
  );
}
```

### 5. Pluralization & Interpolation

```tsx
// Pluralization
<div>{t('validation_error_count', { count: errorCount })}</div>

// Interpolation
<p>{t('verification_unit_expired_date', { date: '2024-12-31' })}</p>
```

### 6. Validation Error Localization

Backend validation errors are mapped to frontend translations:

```tsx
import { ErrorCodeToFrontendKeyMapping } from '@/backend-types';

// Backend returns error code
// { errorCode: 'blood_unit_insufficient_stock' }

// Frontend maps to i18n key
const i18nKey = ErrorCodeToFrontendKeyMapping['blood_unit_insufficient_stock'];
const message = t(i18nKey);
```

### 7. Backend Localization

Backend responses include language-aware messages:

```
GET /api/blood-requests?lang=fr
GET /api/orders?Accept-Language: fr-FR

Response:
{
  "data": [...],
  "language": "fr",
  "supportedLanguages": ["en", "fr"]
}
```

---

## Implementation Checklist

### Frontend

- [ ] All form inputs have associated labels
- [ ] All buttons/links have clear text or aria-labels
- [ ] Focus indicators are visible
- [ ] Keyboard navigation works (Tab, Shift+Tab, Enter, Escape)
- [ ] No keyboard traps
- [ ] Error messages announced to screen readers
- [ ] Form validation runs on blur + submit
- [ ] Color contrast meets WCAG AA
- [ ] Headings use proper hierarchy
- [ ] Images have alt text
- [ ] Modal focus trapping implemented
- [ ] Skip links present

### Translations

- [ ] All user-facing text externalized to translation files
- [ ] Key naming is consistent and hierarchical
- [ ] All translations complete in all supported languages
- [ ] Language switcher implemented
- [ ] Language preference persisted
- [ ] Dates/times localized appropriately
- [ ] Number formatting localized

### Backend

- [ ] Validation error codes defined
- [ ] Error messages externalized
- [ ] Localization middleware applied
- [ ] Language extraction implemented (query params, headers)
- [ ] Validation error responses include error codes
- [ ] Status/enum values localized based on language

### Testing

- [ ] Accessibility tests written for critical flows
- [ ] Keyboard navigation tests pass
- [ ] Screen reader compatible testing done
- [ ] Color contrast verified
- [ ] Translation completeness checked
- [ ] Multi-language testing completed

---

## Testing & Validation

### Tools & Resources

**Accessibility Testing:**
- [axe DevTools](https://www.deque.com/axe/devtools/) - Browser extension
- [WAVE](https://wave.webaim.org/) - Accessibility checker
- [Lighthouse](https://developers.google.com/web/tools/lighthouse) - Built into Chrome DevTools
- [Vite + Testing Library](https://testing-library.com/) - Automated testing

**WCAG Compliance:**
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM Resources](https://webaim.org/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)

### Manual Testing Procedures

#### Keyboard Navigation Test
1. Unplug mouse
2. Use Tab/Shift+Tab to navigate through all interactive elements
3. Use Enter to activate buttons
4. Use Escape to close modals
5. Verify logical tab order

#### Screen Reader Test
1. Windows: Use NVDA (free) or JAWS
2. macOS: Use VoiceOver
3. Test with keyboard only
4. Verify all content is readable
5. Check form labels are announced

#### Color Contrast Test
1. Use WebAIM Contrast Checker
2. Test all button/link states
3. Test success/error messaging
4. Verify no information conveyed by color alone

#### Localization Test
1. Switch language and reload
2. Verify all UI text translated
3. Test form validation in both languages
4. Check error messages display correctly
5. Test backend returns correct language

---

## Critical Accessibility Flows

### Blood Order Creation
- [ ] Multi-step form keyboard accessible
- [ ] Step indicators announcechanges
- [ ] Blood type selection accessible
- [ ] Blood bank map has text alternative
- [ ] Confirmation screen properly structured

### QR Verification
- [ ] Scanner input always focusable
- [ ] Manual entry available as alternative
- [ ] Verification results announced
- [ ] Expired unit warning visible + announced
- [ ] All controls keyboard accessible

### Dispatch Management
- [ ] Rider/vehicle assignment form accessible
- [ ] Real-time updates announced
- [ ] Modal focus properly managed
- [ ] Temperature warnings clearly visible
- [ ] Status changes announced

---

## Continuous Improvement

- Run accessibility audit monthly
- Test with actual assistive technology
- Gather user feedback and iterate
- Keep WCAG 2.1 AA as minimum standard
- Consider AAA compliance for critical flows
- Update translations as content evolves
- Monitor language selector analytics

