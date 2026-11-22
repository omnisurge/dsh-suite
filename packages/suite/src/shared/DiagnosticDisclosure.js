/**
 * Canonical collapsible technical-diagnostic block (ADR-117 D2).
 *
 * Wraps `@omnisurge/dsh-ui` `Disclosure` with `<pre className="omni-ui-excerpt">` so Client
 * pages share one consistent disclosure shape instead of repeating raw-detail boilerplate.
 */
import * as React from 'react';
import {Disclosure} from '@omnisurge/dsh-ui';

export function DiagnosticDisclosure({title, text, testId, preTestId, defaultOpen = false, children}) {
  const preProps = preTestId ? {'data-testid': preTestId, className: 'omni-ui-excerpt'} : {className: 'omni-ui-excerpt'};
  return React.createElement(
    Disclosure,
    testId ? {'data-testid': testId, title, defaultOpen} : {title, defaultOpen},
    text !== undefined && text !== null ? React.createElement('pre', preProps, String(text)) : null,
    children ?? null,
  );
}

/** View-only localization helper: preserve raw diagnostics behind DiagnosticDisclosure. */
export function renderTechnicalFailure(h, t, summary, diagnostic) {
  return h('section', {role: 'alert'},
    h('p', null, t(summary)),
    h(DiagnosticDisclosure, {title: t('technicalDetails'), text: String(diagnostic)}));
}
