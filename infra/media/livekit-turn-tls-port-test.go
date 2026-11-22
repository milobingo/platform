// Added only to the pinned upstream build for the Milo staging regression test.
package service

import (
	"strings"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"

	"github.com/livekit/livekit-server/pkg/config"
	"github.com/livekit/livekit-server/pkg/rtc/types"
)

type miloTURNParticipant struct{ types.LocalParticipant }

func (miloTURNParticipant) ID() livekit.ParticipantID { return "PA_milo_fixture" }

func TestMiloEmbeddedTURNAdvertisedPort(t *testing.T) {
	for _, tc := range []struct {
		name, domain, want string
		port               int
		tlsOnly            bool
	}{
		{"configured-5349", "milo-staging.dgwebservices.nl", "turns:milo-staging.dgwebservices.nl:5349?transport=tcp", 5349, false},
		{"existing-443", "milo-staging.dgwebservices.nl", "turns:milo-staging.dgwebservices.nl:443?transport=tcp", 443, false},
		{"ipv6-format", "2001:db8::1", "turns:[2001:db8::1]:5349?transport=tcp", 5349, false},
		{"tls-only-5349", "milo-staging.dgwebservices.nl", "turns:milo-staging.dgwebservices.nl:5349?transport=tcp", 5349, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conf := &config.Config{}
			conf.TURN = config.TURNConfig{Enabled: true, Domain: tc.domain, TLSPort: tc.port, UDPPort: 3480, TTLSeconds: 300}
			conf.RTC.NodeIP.V4 = "128.140.93.95"
			handler := NewTURNAuthHandler(auth.NewSimpleKeyProvider("milo-fixture-key", "fixture-only-not-a-real-secret"))
			rm := &RoomManager{config: conf, turnAuthHandler: handler}
			before := time.Now().Unix()
			servers := rm.iceServersForParticipant("milo-fixture-key", miloTURNParticipant{}, tc.tlsOnly)
			if len(servers) == 0 {
				t.Fatal("embedded TURN server missing")
			}
			embedded := servers[0]
			foundTLS, foundUDP := false, false
			for _, url := range embedded.Urls {
				if strings.HasPrefix(url, "turns:") {
					if url != tc.want {
						t.Fatalf("wrong TLS endpoint: %s", url)
					}
					foundTLS = true
				} else if strings.HasPrefix(url, "turn:") {
					if url != "turn:128.140.93.95:3480?transport=udp" {
						t.Fatalf("UDP endpoint changed: %s", url)
					}
					foundUDP = true
				}
			}
			if !foundTLS || foundUDP == tc.tlsOnly {
				t.Fatal("TLS/UDP branch selection changed")
			}
			key, participant, expiry, err := handler.ParseUsername(embedded.Username)
			if err != nil || key != "milo-fixture-key" || participant != "PA_milo_fixture" || expiry < before+299 || expiry > time.Now().Unix()+301 {
				t.Fatal("dynamic credential identity or TTL changed")
			}
			password, err := handler.CreatePassword(key, participant, expiry)
			if err != nil || password == "" || embedded.Credential != password {
				t.Fatal("dynamic credential validation changed")
			}
		})
	}
}
