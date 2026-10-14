// Copyright (c) 2025 LucX-UI Project.
// Licensed under the PolyForm Noncommercial License 1.0.0.
// LucX-UI Component. Free for personal and educational use.
// Commercial use (including VPN resale) requires explicit written permission from the author.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package sub

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/mhsanaei/3x-ui/v3/internal/database"
	"github.com/mhsanaei/3x-ui/v3/internal/database/model"
	wgutil "github.com/mhsanaei/3x-ui/v3/internal/util/wireguard"
)

// decodeIncyAmneziaWG returns the .conf and remark of an amneziawg://<base64url .conf>#remark line.
func decodeIncyAmneziaWG(t *testing.T, link string) (string, string) {
	t.Helper()
	body, ok := strings.CutPrefix(link, "amneziawg://")
	if !ok {
		t.Fatalf("link %q has no amneziawg:// scheme", link)
	}
	body, fragment, _ := strings.Cut(body, "#")
	if strings.ContainsAny(body, "@?") {
		t.Fatalf("Incy link must be base64url only, got userinfo/query form: %s", link)
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("link body is not base64url: %v\n%s", err, link)
	}
	remark, err := url.PathUnescape(fragment)
	if err != nil {
		t.Fatalf("fragment %q: %v", fragment, err)
	}
	return string(raw), remark
}

func TestGenAwgLink_IncyGetsOneBase64ConfLine(t *testing.T) {
	s := &SubService{incyClient: true}
	link := s.genAwgLink(awgLinkInbound(awgLinkClientSettings), "user")
	if strings.Contains(link, "\n") || strings.Contains(link, "vpn://") {
		t.Fatalf("Incy must get exactly one amneziawg:// line, got:\n%s", link)
	}
	conf, remark := decodeIncyAmneziaWG(t, link)
	for _, want := range []string{
		"[Interface]", "PrivateKey = peerPriv", "Jc = 8", "S4 = 15", "H1 = 100000-500000",
		"[Peer]", "PresharedKey = peerPsk", "Endpoint = 203.0.113.1:51820",
	} {
		if !strings.Contains(conf, want) {
			t.Errorf("decoded conf missing %q:\n%s", want, conf)
		}
	}
	if remark == "" || !strings.HasPrefix(conf, "# "+remark+"\n") {
		t.Fatalf("fragment %q must name the server like the conf comment:\n%s", remark, conf)
	}
}

func TestGenAmneziaWGLink_IncyGetsAmneziaWGScheme(t *testing.T) {
	serverPriv, serverPub, err := wgutil.GenerateWireguardKeypair()
	if err != nil {
		t.Fatal(err)
	}
	clientPriv, _, err := wgutil.GenerateWireguardKeypair()
	if err != nil {
		t.Fatal(err)
	}
	inbound := &model.Inbound{
		Listen: "203.0.113.7", Port: 51820, Protocol: model.AmneziaWG, Remark: "awg-sub",
		Settings: `{"server":{"privateKey":"` + serverPriv + `","publicKey":"` + serverPub + `","mtu":1420},` +
			`"clients":[{"email":"user","privateKey":"` + clientPriv + `","allowedIPs":["10.8.1.2/32"],"keepAlive":25}]}`,
	}

	plain := (&SubService{}).genAmneziaWGLink(inbound, "user")
	incy := (&SubService{incyClient: true}).genAmneziaWGLink(inbound, "user")

	conf, remark := decodeIncyAmneziaWG(t, incy)
	for _, want := range []string{"[Interface]", "PrivateKey = " + clientPriv, "PublicKey = " + serverPub, "Endpoint = 203.0.113.7:51820"} {
		if !strings.Contains(conf, want) {
			t.Errorf("decoded conf missing %q:\n%s", want, conf)
		}
	}
	if remark == "" {
		t.Error("Incy link must carry the server name after #")
	}
	if !strings.HasPrefix(plain, "vpn://") || base64.RawURLEncoding.EncodeToString([]byte(conf)) != strings.TrimPrefix(plain, "vpn://") {
		t.Fatalf("other clients keep vpn:// with the same payload, got %q", plain)
	}
}

func TestRawSub_IncyUserAgentSwitchesAwgFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	initSubDB(t)
	db := database.GetDB()
	settings := strings.Replace(awgLinkClientSettings, `"enable":true}`, `"enable":true,"subId":"awg-sub"}`, 1)
	ib := &model.Inbound{Protocol: model.AWG, Enable: true, Port: 51820, Listen: "203.0.113.1", Remark: "awg-link", Tag: "awg-1", Settings: settings}
	if err := db.Create(ib).Error; err != nil {
		t.Fatal(err)
	}
	rec := &model.ClientRecord{Email: "user", SubID: "awg-sub", Enable: true, PrivateKey: "peerPriv", PublicKey: "peerPub", PreSharedKey: "peerPsk"}
	if err := db.Create(rec).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ClientInbound{ClientId: rec.Id, InboundId: ib.Id}).Error; err != nil {
		t.Fatal(err)
	}

	router := gin.New()
	NewSUBController(router.Group("/"))
	fetch := func(userAgent string) string {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/sub/awg-sub", nil)
		req.Host = "sub.example.com"
		req.Header.Set("User-Agent", userAgent)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status %d body %s", userAgent, w.Code, w.Body.String())
		}
		body := strings.TrimSpace(w.Body.String())
		if raw, err := base64.StdEncoding.DecodeString(body); err == nil {
			body = strings.TrimSpace(string(raw))
		}
		return body
	}

	incy := fetch("INCY/2.4.1/android")
	if strings.Contains(incy, "vpn://") || strings.Count(incy, "amneziawg://") != 1 {
		t.Fatalf("Incy body must hold one amneziawg:// line and no vpn://:\n%s", incy)
	}
	if conf, _ := decodeIncyAmneziaWG(t, incy); !strings.Contains(conf, "PrivateKey = peerPriv") {
		t.Fatalf("Incy conf lacks the client key:\n%s", conf)
	}

	other := fetch("v2rayNG/1.8.5")
	if !strings.Contains(other, "amneziawg://peerPriv@") || !strings.Contains(other, "\nvpn://") {
		t.Fatalf("other clients keep the amneziawg://key@host + vpn:// pair:\n%s", other)
	}
}
