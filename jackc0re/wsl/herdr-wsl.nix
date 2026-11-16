# Herdr on Windows reaches this distro as the machine "wsl" over ssh
# (Host wsl in Windows' ~/.ssh/config, key ~/.ssh/herdr_wsl_ed25519).
# Loopback only, key only, user nixos only. See github.com/emoss08/herdr-wsl.
{ ... }:
{
  services.openssh = {
    enable = true;
    ports = [ 2222 ];
    listenAddresses = [ { addr = "127.0.0.1"; port = 2222; } ];
    openFirewall = false;
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
      AllowUsers = [ "nixos" ];
    };
  };

  # Keep user services (herdr-core, its agents) running without a login session.
  users.users.nixos.linger = true;

  # Public key only (safe to commit); accepted from loopback only.
  users.users.nixos.openssh.authorizedKeys.keys = [
    ''from="127.0.0.1,::1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID2LXyl/Odtzj1mhmQLK9FEmj0bF0P1Wu6jOvZK8CPFn herdr-wsl''
  ];
}
