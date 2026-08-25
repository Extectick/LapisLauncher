package ru.lapis.bridge.client;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelFutureListener;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientLoginNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientHandshakePacketListenerImpl;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.FriendlyByteBuf;

import ru.lapis.bridge.Protocol;

/** Reads short-lived per-connection launch contexts from the loopback endpoint created by Lapis Launcher. */
public final class LapisBridgeClient implements ClientModInitializer {
  private final AtomicReference<LaunchContext> launchContext = new AtomicReference<>();
  private boolean connectionStarted;

  @Override
  public void onInitializeClient() {
    ClientLoginNetworking.registerGlobalReceiver(Protocol.AUTH_CHANNEL, this::answerChallenge);
    ClientTickEvents.END_CLIENT_TICK.register(this::connectWhenReady);
  }

  private void connectWhenReady(Minecraft client) {
    if (connectionStarted || client.getConnection() != null) return;
    // Minecraft replaces early screens while it is still loading resources. Starting a
    // connection before the game load finishes makes the connection UI disappear.
    if (!client.isGameLoadFinished()) return;
    connectionStarted = true;
    CompletableFuture.supplyAsync(LapisBridgeClient::readContext).whenComplete((context, error) -> client.execute(() -> {
      if (error != null) return;
      launchContext.set(context);
      String address = context.host + ":" + context.port;
      ServerData server =
          new ServerData(context.serverName, address, ServerData.Type.OTHER);
      // Lapis is a launcher-managed server whose resource pack is part of the
      // selected build. Mark it as trusted before connecting so Minecraft does
      // not show the resource-pack confirmation on every transient auto-connect.
      server.setResourcePackStatus(ServerData.ServerPackStatus.ENABLED);
      rememberVisibleServer(client, server);
      ConnectScreen.startConnecting(new TitleScreen(), client, new ServerAddress(context.host, context.port), server, false, null);
    }));
  }

  private static void rememberVisibleServer(
      Minecraft client, ServerData selected) {
    ServerList servers = new ServerList(client);
    servers.load();

    ServerData saved = null;
    for (int index = 0; index < servers.size(); index++) {
      ServerData candidate = servers.get(index);
      if (selected.ip.equals(candidate.ip)) {
        saved = candidate;
        break;
      }
    }

    ServerData unhidden;
    while ((unhidden = servers.unhide(selected.ip)) != null) {
      if (saved == null) saved = unhidden;
      else servers.remove(unhidden);
    }
    if (saved == null) {
      saved = selected;
      servers.add(saved, false);
    }
    saved.name = selected.name;
    saved.ip = selected.ip;
    saved.setResourcePackStatus(ServerData.ServerPackStatus.ENABLED);
    // Vanilla writes servers.dat through a temporary file and keeps
    // servers.dat_old as a rollback copy. All unrelated entries remain intact.
    servers.save();
  }

  private CompletableFuture<FriendlyByteBuf> answerChallenge(Minecraft client, ClientHandshakePacketListenerImpl listener, FriendlyByteBuf buffer, Consumer<ChannelFutureListener> callbacks) {
    return CompletableFuture.supplyAsync(() -> {
      Protocol.Challenge challenge = Protocol.readChallenge(buffer);
      LaunchContext context = launchContext.getAndSet(null);
      if (context == null || context.isExpiring()) context = readContext();
      if (challenge.protocolVersion() != Protocol.VERSION || !challenge.serverId().equals(context.serverId) || !challenge.buildId().equals(context.buildId)) {
        throw new IllegalStateException("Lapis launch context does not match this server");
      }
      FriendlyByteBuf reply = new FriendlyByteBuf(Unpooled.buffer());
      Protocol.writeResponse(reply, new Protocol.Response(
          context.ticket,
          Base64.getUrlEncoder().withoutPadding().encodeToString(challenge.challenge()),
          context.nickname,
          context.minecraftUuid,
          context.buildId,
          context.bridgeProtocolVersion));
      return reply;
    });
  }

  private static LaunchContext readContext() {
    String port = System.getenv("LAPIS_BRIDGE_PORT");
    String nonce = System.getenv("LAPIS_BRIDGE_NONCE");
    if (port == null || nonce == null || !port.matches("[0-9]{1,5}")) throw new IllegalStateException("Launch context is unavailable");
    try {
      HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v1/launch-context"))
          .timeout(Duration.ofSeconds(5))
          .header("X-Lapis-Bootstrap", nonce)
          .POST(HttpRequest.BodyPublishers.noBody())
          .build();
      HttpResponse<String> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build().send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (response.statusCode() != 200 || response.body().length() > 2048) throw new IllegalStateException("Launch context was rejected");
      return LaunchContext.parse(response.body());
    } catch (Exception error) {
      throw new IllegalStateException("Launch context is unavailable", error);
    }
  }

  private record LaunchContext(
      String serverId,
      String serverName,
      String host,
      int port,
      String buildId,
      String ticket,
      String nickname,
      String minecraftUuid,
      int bridgeProtocolVersion,
      Instant expiresAt) {
    static LaunchContext parse(String json) {
      JsonObject payload = JsonParser.parseString(json).getAsJsonObject();
      String serverId = stringField(payload, "serverId");
      String serverName = stringField(payload, "serverName");
      String host = stringField(payload, "host");
      int port = intField(payload, "port");
      String buildId = stringField(payload, "buildId");
      String ticket = stringField(payload, "ticket");
      String nickname = stringField(payload, "nickname");
      String minecraftUuid = stringField(payload, "minecraftUuid");
      int protocol = intField(payload, "bridgeProtocolVersion");
      Instant expiresAt = Instant.parse(stringField(payload, "expiresAt"));
      if (!nickname.matches("[A-Za-z0-9_]{3,16}") || !minecraftUuid.matches("[a-fA-F0-9]{32}") || ticket.length() < 32) throw new IllegalArgumentException("Invalid launch context");
      if (serverName.isBlank()
          || serverName.length() > 80
          || host.isBlank()
          || port < 1
          || port > 65535)
        throw new IllegalArgumentException("Invalid server address");
      return new LaunchContext(
          serverId,
          serverName,
          host,
          port,
          buildId,
          ticket,
          nickname,
          minecraftUuid,
          protocol,
          expiresAt);
    }

    boolean isExpiring() { return expiresAt.isBefore(Instant.now().plusSeconds(5)); }

    private static String stringField(JsonObject payload, String name) {
      JsonElement value = payload.get(name);
      if (value == null
          || !value.isJsonPrimitive()
          || !value.getAsJsonPrimitive().isString())
        throw new IllegalArgumentException("Missing launch context field: " + name);
      return value.getAsString();
    }

    private static int intField(JsonObject payload, String name) {
      JsonElement value = payload.get(name);
      if (value == null
          || !value.isJsonPrimitive()
          || !value.getAsJsonPrimitive().isNumber())
        throw new IllegalArgumentException("Missing launch context field: " + name);
      return value.getAsInt();
    }
  }
}
