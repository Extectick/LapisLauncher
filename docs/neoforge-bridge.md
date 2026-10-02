# Lapis Bridge for NeoForge 1.21.1

This is a separate build from the Fabric 26.2 bridge. The same
`lapis-bridge-neoforge-1.21.1-0.1.2.jar` is required on the server and in the
Lapis Launcher client build. It is not a standalone password mod: it validates
one-time game tickets issued by the Lapis API. Direct vanilla/NeoForge launches
without a Lapis ticket are denied before joining the world.

Build with Java 21:

```powershell
Set-Location V:\GitProjects\LapisLauncher\neoforge-bridge
& 'C:\Program Files\Eclipse Adoptium\jdk-21.0.3.9-hotspot\bin\java.exe' -cp gradle\wrapper\gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain build
```

The JAR is written to `neoforge-bridge\build\libs`. The launcher/API source
supports `loader=neoforge`, `minecraftVersion=1.21.1`, and a 21.1.x NeoForge
version. The client installer uses the official NeoForge installer with Java 21
and checks its SHA-1 before running it. NeoForge mod metadata is recognized in
the admin panel, but dependency compatibility is deliberately reported as
unverified until the game is actually launched.

Server process environment:

```text
LAPIS_API_URL=https://<reachable-lapis-api>
LAPIS_BRIDGE_SHARED_KEY=<same-secret-configured-in-lapis-api>
```

When the host also runs the Fabric server, override only the NeoForge IDs in
`user_jvm_args.txt` (do not put the shared key on the command line):

```text
-Dlapis.serverId=thaumcraft-reborn
-Dlapis.buildId=thaumcraft-reborn-1.21.1-neoforge-21.1.248
```

The API exposes the raw offline-profile MD5 while Minecraft stores the UUID
with version bits. The Bridge validates both forms without changing a player's
saved UUID.

On a successful ticket validation, the Bridge requests the API's
signed-skin-v1 response. It removes any other textures property from the
server-side player profile and attaches only the signed skin stored in Lapis
Launcher. Players without an uploaded skin use Minecraft's default skin.
SkinRestorer must remain outside the NeoForge server's mods directory so it
cannot override launcher skins.

Keep the API URL and shared key private. Without the shared key, all Bridge
logins are denied. The server must use the same player UUID policy as the
launcher-issued profile (currently offline-mode UUIDs); confirm existing player
data and inventories in a staging copy before changing authorization on the
live world. Never put the Fabric and NeoForge bridge JARs in one mods folder.

Migration order:

1. Publish the NeoForge game build and client mod JAR in the Lapis API.
2. Update the Lapis Launcher/API and verify a client installs Java 21,
   NeoForge 21.1.x, and the matching Bridge JAR.
3. Test a copy of the server with the NeoForge Bridge and valid API settings.
   Check successful login, expired ticket rejection, direct-client rejection,
   inventory preservation, and reconnect after an API outage.
4. Only after that test, remove the old Vouch authentication mod, deploy the
   Bridge to the live server, and restart it through Crafty.

Production Thaumcraft Reborn now uses Bridge 0.1.2 on port 25566. Vouch,
SkinRestorer, and the older Bridge are in disabled-mods. The prior world was
moved to C:\Crafty\backups\thaumcraft-reborn-world-before-reset-2026-10-03;
Crafty generated a new world. A real client skin check remains necessary.
