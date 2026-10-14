// Copyright (c) 2025 LucX-UI Project.
// Licensed under the PolyForm Noncommercial License 1.0.0.
// LucX-UI Component. Free for personal and educational use.
// Commercial use (including VPN resale) requires explicit written permission from the author.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package sub

import "encoding/base64"

// incyAmneziaWGLink is Incy's only AmneziaWG share form: the whole client .conf as base64url.
// Incy skips the userinfo@host?params form and vpn:// (docs.incy.cc, subscription format).
func incyAmneziaWGLink(conf, remark string) string {
	link := "amneziawg://" + base64.RawURLEncoding.EncodeToString([]byte(conf))
	if remark != "" {
		link += "#" + escapeLinkFragment(remark, encodeURIComponent)
	}
	return link
}
