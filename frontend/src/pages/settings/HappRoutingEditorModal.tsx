import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Modal, Select, Space, Tabs, Tooltip, Typography } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import JsonEditor from '@/components/form/JsonEditor';
import { GeoBrowserModal } from '@/components/geodata';
import { keys } from '@/api/queryKeys';
import { fetchXrayConfig } from '@/hooks/useXraySetting';
import { formatTokens, parseTokens } from '@/lib/xray/geoTokens';
import type { HappRoutingProfile } from '@/schemas/happRouting';
import {
  applyGeoSelection,
  buildHappRoutingDeeplink,
  clientGeoToken,
  geoTokensOf,
  loadHappRouting,
  parseHappRoutingJson,
  parseHappRoutingList,
  routingGeoKind,
  routingGeoSources,
  type HappRoutingListKey,
  type RoutingGeoKind,
  type RoutingScheme,
} from './happRoutingEditor';

interface HappRoutingEditorModalProps {
  input: string;
  onCancel: () => void;
  onGenerate: (deeplink: string) => void;
  scheme?: RoutingScheme;
}

const basicFields: {
  key: HappRoutingListKey;
  label: string;
  placeholder: string;
  kind: RoutingGeoKind;
}[] = [
  {
    key: 'DirectSites',
    label: 'subHappDirectDomains',
    placeholder: 'domain:ir\ndomain:cn\nexample.local',
    kind: 'site',
  },
  {
    key: 'ProxySites',
    label: 'subHappProxyDomains',
    placeholder: 'geosite:google\nyoutube.com',
    kind: 'site',
  },
  {
    key: 'BlockSites',
    label: 'subHappBlockDomains',
    placeholder: 'geosite:category-ads-all\nanalytics.google.com',
    kind: 'site',
  },
  {
    key: 'DirectIp',
    label: 'subHappDirectIPs',
    placeholder: 'geoip:ir\n192.168.0.0/16\n10.0.0.0/8',
    kind: 'ip',
  },
  {
    key: 'ProxyIp',
    label: 'subHappProxyIPs',
    placeholder: '1.1.1.1/32\n8.8.8.8/32',
    kind: 'ip',
  },
  {
    key: 'BlockIp',
    label: 'subHappBlockIPs',
    placeholder: 'geoip:phishing\n0.0.0.0/8',
    kind: 'ip',
  },
];

type BasicBuffers = Record<HappRoutingListKey, string>;
interface GeoUrls {
  site: string;
  ip: string;
}

const GEO_URL_FIELD: Record<RoutingGeoKind, 'Geositeurl' | 'Geoipurl'> = {
  site: 'Geositeurl',
  ip: 'Geoipurl',
};
const DEFAULT_GEO_FILE: Record<RoutingGeoKind, string> = { site: 'geosite.dat', ip: 'geoip.dat' };

function basicBuffers(profile: HappRoutingProfile | null): BasicBuffers {
  return {
    DirectSites: profile?.DirectSites?.join('\n') ?? '',
    ProxySites: profile?.ProxySites?.join('\n') ?? '',
    BlockSites: profile?.BlockSites?.join('\n') ?? '',
    DirectIp: profile?.DirectIp?.join('\n') ?? '',
    ProxyIp: profile?.ProxyIp?.join('\n') ?? '',
    BlockIp: profile?.BlockIp?.join('\n') ?? '',
  };
}

function profileGeoUrls(profile: HappRoutingProfile | null): GeoUrls {
  const url = (value: unknown) => (typeof value === 'string' ? value : '');
  return { site: url(profile?.Geositeurl), ip: url(profile?.Geoipurl) };
}

function mergeBasicRules(
  profile: HappRoutingProfile,
  buffers: BasicBuffers,
  geoUrls: GeoUrls,
): HappRoutingProfile {
  const next = { ...profile };
  // Only replace edited lists; absent lists and all other profile fields must survive unchanged.
  for (const { key } of basicFields) {
    if (buffers[key] !== (profile[key]?.join('\n') ?? '')) {
      next[key] = parseHappRoutingList(buffers[key]);
    }
  }
  const current = profileGeoUrls(profile);
  for (const kind of ['site', 'ip'] as const) {
    if (geoUrls[kind] === current[kind]) continue;
    if (geoUrls[kind]) next[GEO_URL_FIELD[kind]] = geoUrls[kind];
    else delete next[GEO_URL_FIELD[kind]];
  }
  return next;
}

const loadErrorKeys = {
  happ: {
    off: 'subHappEditorLoadOff',
    remote: 'subHappEditorLoadRemote',
    invalid: 'subHappEditorLoadInvalid',
  },
  incy: {
    off: 'subIncyEditorLoadOff',
    remote: 'subIncyEditorLoadRemote',
    invalid: 'subIncyEditorLoadInvalid',
  },
};
const titleKeys = { happ: 'subHappModalTitle', incy: 'subIncyModalTitle' };

export default function HappRoutingEditorModal({
  input,
  onCancel,
  onGenerate,
  scheme = 'happ',
}: HappRoutingEditorModalProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [loaded] = useState(() => loadHappRouting(input, scheme));
  const [profile, setProfile] = useState(() => (loaded.success ? loaded.profile : null));
  const [activeTab, setActiveTab] = useState('basic');
  // Keep raw buffers while typing so trailing newlines and temporarily invalid JSON are not lost.
  const [buffers, setBuffers] = useState(() => basicBuffers(profile));
  const [geoUrls, setGeoUrls] = useState(() => profileGeoUrls(profile));
  const [browsing, setBrowsing] = useState<HappRoutingListKey | null>(null);
  const [jsonText, setJsonText] = useState(() => (profile ? JSON.stringify(profile, null, 2) : ''));
  const advancedProfile = activeTab === 'advanced' ? parseHappRoutingJson(jsonText) : null;
  const invalidJson = activeTab === 'advanced' && advancedProfile === null;

  const configQuery = useQuery({
    queryKey: keys.xray.config(),
    queryFn: fetchXrayConfig,
    staleTime: Infinity,
  });
  const sources = useMemo(() => routingGeoSources(configQuery.data), [configQuery.data]);

  const geoOptions = (kind: RoutingGeoKind) => {
    const options = sources
      .filter((source) => routingGeoKind(source.file) === kind)
      .map((source) => ({ value: source.url, label: source.file, title: source.url }));
    const selected = geoUrls[kind];
    if (selected && !options.some((option) => option.value === selected)) {
      options.push({ value: selected, label: selected, title: selected });
    }
    return [
      { value: '', label: t('pages.settings.subRoutingGeoClientDefault'), title: '' },
      ...options,
    ];
  };

  // Categories are browsed in the panel's copy of the database the client downloads.
  const browseFile = (kind: RoutingGeoKind) =>
    sources.find((source) => source.url === geoUrls[kind])?.file ?? DEFAULT_GEO_FILE[kind];
  const browsingField = basicFields.find((field) => field.key === browsing);

  const switchTab = (nextTab: string) => {
    if (!profile || nextTab === activeTab) return;
    if (nextTab === 'advanced') {
      const next = mergeBasicRules(profile, buffers, geoUrls);
      setProfile(next);
      setJsonText(JSON.stringify(next, null, 2));
    } else {
      if (!advancedProfile) return;
      setProfile(advancedProfile);
      setBuffers(basicBuffers(advancedProfile));
      setGeoUrls(profileGeoUrls(advancedProfile));
    }
    setActiveTab(nextTab);
  };

  const generate = () => {
    if (!loaded.success || !profile) return;
    const next =
      activeTab === 'advanced' ? advancedProfile : mergeBasicRules(profile, buffers, geoUrls);
    if (next) onGenerate(buildHappRoutingDeeplink(next, loaded.mode, scheme));
  };

  return (
    <Modal
      title={t(`pages.settings.${titleKeys[scheme]}`)}
      open
      onCancel={onCancel}
      onOk={generate}
      okText={t('pages.settings.subHappBuildDeeplink')}
      okButtonProps={{ disabled: !loaded.success || invalidJson }}
      width={650}
    >
      <Space orientation="vertical" style={{ width: '100%', marginTop: 12 }} size="middle">
        {!loaded.success ? (
          <Alert
            type="error"
            showIcon
            title={t(`pages.settings.${loadErrorKeys[scheme][loaded.error]}`)}
          />
        ) : loaded.isNew ? (
          <Alert type="info" showIcon title={t('pages.settings.subHappEditorNew')} />
        ) : null}
        {loaded.success ? (
          <Tabs
            activeKey={activeTab}
            onChange={switchTab}
            destroyOnHidden
            items={[
              {
                key: 'basic',
                label: t('pages.settings.subHappEditorBasic'),
                disabled: invalidJson,
                children: (
                  <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                    <Typography.Text type="secondary" id={`${fieldId}-hint`}>
                      {t('pages.settings.subHappEditorListHint')}
                    </Typography.Text>
                    {(['site', 'ip'] as const).map((kind) => (
                      <div key={kind}>
                        <label
                          htmlFor={`${fieldId}-geo-${kind}`}
                          style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}
                        >
                          {t(
                            kind === 'site'
                              ? 'pages.settings.subRoutingGeoSiteDb'
                              : 'pages.settings.subRoutingGeoIpDb',
                          )}
                        </label>
                        <Select
                          id={`${fieldId}-geo-${kind}`}
                          aria-describedby={`${fieldId}-geo-hint`}
                          style={{ width: '100%' }}
                          value={geoUrls[kind]}
                          loading={configQuery.isLoading}
                          options={geoOptions(kind)}
                          onChange={(value: string) =>
                            setGeoUrls((previous) => ({ ...previous, [kind]: value }))
                          }
                        />
                      </div>
                    ))}
                    <Typography.Text type="secondary" id={`${fieldId}-geo-hint`}>
                      {t('pages.settings.subRoutingGeoDbDesc')}
                    </Typography.Text>
                    {basicFields.map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <Space
                          style={{
                            width: '100%',
                            justifyContent: 'space-between',
                            marginBottom: 4,
                          }}
                        >
                          <label htmlFor={`${fieldId}-${key}`} style={{ fontWeight: 600 }}>
                            {t(`pages.settings.${label}`)}
                          </label>
                          <Tooltip title={t('pages.xray.geoBrowser.openTooltip')}>
                            <Button
                              size="small"
                              icon={<DatabaseOutlined />}
                              aria-label={t('pages.xray.geoBrowser.openTooltip')}
                              onClick={() => setBrowsing(key)}
                            />
                          </Tooltip>
                        </Space>
                        <Input.TextArea
                          id={`${fieldId}-${key}`}
                          aria-describedby={`${fieldId}-hint`}
                          rows={2}
                          value={buffers[key]}
                          placeholder={placeholder}
                          onChange={(event) =>
                            setBuffers((previous) => ({ ...previous, [key]: event.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </Space>
                ),
              },
              {
                key: 'advanced',
                label: t('pages.settings.subHappEditorAdvanced'),
                children: (
                  <Space orientation="vertical" style={{ width: '100%' }} size="middle">
                    <Typography.Text type="secondary">
                      {t('pages.settings.subHappEditorAdvancedHint')}
                    </Typography.Text>
                    {invalidJson ? (
                      <Alert
                        type="error"
                        showIcon
                        title={t('pages.settings.subHappEditorInvalidJson')}
                      />
                    ) : null}
                    <JsonEditor
                      value={jsonText}
                      onChange={setJsonText}
                      minHeight="320px"
                      maxHeight="50vh"
                    />
                  </Space>
                ),
              },
            ]}
          />
        ) : null}
      </Space>
      {browsingField ? (
        <GeoBrowserModal
          open
          kind={browsingField.kind}
          files={[browseFile(browsingField.kind)]}
          formatToken={clientGeoToken}
          value={formatTokens(geoTokensOf(buffers[browsingField.key]))}
          onApply={(next) => {
            const key = browsingField.key;
            setBuffers((previous) => ({
              ...previous,
              [key]: applyGeoSelection(previous[key], parseTokens(next)),
            }));
            setBrowsing(null);
          }}
          onClose={() => setBrowsing(null)}
        />
      ) : null}
    </Modal>
  );
}
