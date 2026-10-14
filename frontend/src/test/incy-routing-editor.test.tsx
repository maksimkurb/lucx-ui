import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AllSetting } from '@/models/setting';
import IncySettingsContent from '@/pages/settings/IncySettingsContent';
import { toBase64Utf8 } from '@/pages/settings/happPresets';
import { HttpUtil, Msg } from '@/utils';

import { renderWithProviders } from './test-utils';

afterEach(() => {
  vi.restoreAllMocks();
});

const RU_SITE_URL = 'https://example.com/russia/geosite.dat';
const profile = {
  Name: 'Incy',
  GlobalProxy: 'true',
  DirectSites: ['geosite:cn'],
  ProxySites: ['regexp:^a{1,2}\\.example$'],
  FutureSetting: { kept: true },
};

function mockPanel() {
  const xrayPayload = {
    xraySetting: {
      geodata: {
        assets: [
          { url: 'https://example.com/default/geosite.dat', file: 'geosite.dat' },
          { url: RU_SITE_URL, file: 'geosite_RU.dat' },
          { url: 'https://example.com/russia/geoip.dat', file: 'geoip_RU.dat' },
        ],
      },
    },
  };
  vi.spyOn(HttpUtil, 'post').mockImplementation(async (url: string) =>
    url === '/panel/api/xray/'
      ? new Msg(true, '', JSON.stringify(xrayPayload))
      : new Msg(true, '', []),
  );
  return vi.spyOn(HttpUtil, 'get').mockImplementation(async (url: string) => {
    if (url.includes('/geodata/files')) {
      return new Msg(true, '', [
        { name: 'geosite.dat', kind: 'site', size: 1, modifiedAt: 1, categories: 2 },
        { name: 'geosite_RU.dat', kind: 'site', size: 1, modifiedAt: 1, categories: 2 },
      ]);
    }
    if (url.includes('/geodata/categories')) {
      return new Msg(true, '', {
        total: 2,
        items: [
          { code: 'cn', entries: 1, attributes: [] },
          { code: 'youtube', entries: 1, attributes: [] },
        ],
      });
    }
    if (url.includes('/geodata/entries')) return new Msg(true, '', { total: 0, items: [] });
    return new Msg(true, '', null);
  });
}

function renderIncy() {
  const updateSetting = vi.fn<(patch: Partial<AllSetting>) => void>();
  function Harness() {
    const [allSetting, setAllSetting] = useState(() =>
      Object.assign(new AllSetting(), {
        subIncyRoutingRules: `incy://routing/onadd/${toBase64Utf8(JSON.stringify(profile))}`,
      }),
    );
    return (
      <IncySettingsContent
        allSetting={allSetting}
        updateSetting={(patch) => {
          updateSetting(patch);
          setAllSetting((previous) => Object.assign(new AllSetting(), previous, patch));
        }}
        isMobile={false}
        remoteSourceBadge={() => null}
      />
    );
  }
  renderWithProviders(<Harness />);
  return updateSetting;
}

function decode(link: string): Record<string, unknown> {
  const payload = link.replace(/^incy:\/\/routing\/onadd\//, '');
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))),
  ) as Record<string, unknown>;
}

describe('Incy routing editor', () => {
  it(
    'picks categories from the chosen database and pins it in the profile',
    { timeout: 30_000 },
    async () => {
      const get = mockPanel();
      const user = userEvent.setup();
      const updateSetting = renderIncy();

      const routingTab = Array.from(document.querySelectorAll('.ant-tabs-tab')).find(
        (tab) => tab.textContent === 'Routing',
      );
      fireEvent.click(routingTab as Element);
      await user.click(screen.getByRole('button', { name: 'Visual Rule Generator' }));
      const editor = within(screen.getByRole('dialog'));
      expect(editor.getByText('Incy Visual Routing Rule Generator')).toBeTruthy();

      await user.click(editor.getByRole('combobox', { name: 'Geosite database' }));
      await user.click(await screen.findByTitle(RU_SITE_URL));

      const browseButtons = editor.getAllByRole('button', { name: 'Browse geo categories' });
      await user.click(browseButtons[1]);
      const youtube = await screen.findByText('youtube');
      await user.click(
        within(youtube.closest('.ant-table-row') as HTMLElement).getByRole('checkbox'),
      );
      await user.click(screen.getByRole('button', { name: /apply/i }));

      const proxySites = editor.getByRole('textbox', { name: 'Proxy Domains (Tunnel)' });
      await waitFor(() =>
        expect((proxySites as HTMLTextAreaElement).value).toBe(
          'regexp:^a{1,2}\\.example$\ngeosite:youtube',
        ),
      );
      expect(
        get.mock.calls
          .filter(([url]) => String(url).includes('/geodata/categories'))
          .every(([, params]) => (params as { file?: string }).file === 'geosite_RU.dat'),
      ).toBe(true);

      await user.click(editor.getByRole('button', { name: 'Generate Deeplink' }));

      const link = updateSetting.mock.calls.at(-1)?.[0].subIncyRoutingRules ?? '';
      expect(link.startsWith('incy://routing/onadd/')).toBe(true);
      expect(decode(link)).toEqual({
        ...profile,
        ProxySites: ['regexp:^a{1,2}\\.example$', 'geosite:youtube'],
        Geositeurl: RU_SITE_URL,
      });
    },
  );
});
