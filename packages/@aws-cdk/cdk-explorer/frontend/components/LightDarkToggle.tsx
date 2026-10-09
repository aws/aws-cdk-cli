import type { ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Icon from '@cloudscape-design/components/icon';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import React from 'react';

export type LightDarkPreference = 'system' | 'dark' | 'light';

let userPreference = localStorage.getItem('light-dark-preference') as LightDarkPreference | null ?? 'system';
const systemDarkMode = window.matchMedia('(prefers-color-scheme: dark)');

// Initialize color mode based on user's OS preference and stay in sync if the preference changes.
systemDarkMode.addEventListener('change', () => refreshDarkMode());
refreshDarkMode();

function refreshDarkMode() {
  if (userPreference === 'system') {
    applyMode(systemDarkMode.matches ? Mode.Dark : Mode.Light);
  } else if (userPreference === 'dark') {
    applyMode(Mode.Dark);
  } else {
    applyMode(Mode.Light);
  }
}

export function LightDarkToggle(): JSX.Element {
  const [preference, setPref] = React.useState(userPreference);

  const onItemFollow = React.useCallback((detail: CustomEvent<ButtonDropdownProps.ItemClickDetails>) => {
    const choice = detail.detail.id as LightDarkPreference;
    userPreference = choice;
    localStorage.setItem('light-dark-preference', choice);
    refreshDarkMode();
    setPref(choice);
  }, []);

  return (
    <ButtonDropdown
      items={[
        { text: 'Light mode', id: 'light', iconName: preference === 'light' ? 'check' : undefined },
        { text: 'Dark mode', id: 'dark', iconName: preference === 'dark' ? 'check' : undefined },
        { text: 'Follow system', id: 'system', iconName: preference === 'system' ? 'check': undefined },
      ]}
      onItemClick={onItemFollow}
    >
      <Icon name="light-dark"></Icon>
    </ButtonDropdown>
  );
}
