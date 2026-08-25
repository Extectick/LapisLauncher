package ru.lapis.bridge.server;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.buffer.Unpooled;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.ServerLoginConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerLoginNetworking;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.server.network.ServerLoginPacketListenerImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ru.lapis.bridge.Protocol;

/** Fail-closed login bridge. It never accepts a connection until the API atomically consumes its ticket. */
public final class LapisBridgeServer implements ModInitializer {
  private static final Logger LOGGER = LoggerFactory.getLogger("lapis-bridge");
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final Pattern NICKNAME = Pattern.compile("[A-Za-z0-9_]{3,16}");
  private static final Pattern BASE64 = Pattern.compile("[A-Za-z0-9+/]+={0,2}");
  private static final Pattern TEXTURE_URL = Pattern.compile("https://textures\\.minecraft\\.net/texture/[a-f0-9]{64}", Pattern.CASE_INSENSITIVE);
  private final Map<ServerLoginPacketListenerImpl, byte[]> challenges = new ConcurrentHashMap<>();
  private BridgeConfig config;

  @Override
  public void onInitialize() {
    config = BridgeConfig.fromEnvironment();
    LOGGER.info("Lapis login bridge is enabled for server '{}' and build '{}'.", config.serverId, config.buildId);
    ServerLoginConnectionEvents.QUERY_START.register((listener, server, sender, synchronizer) -> {
      byte[] challenge = new byte[32];
      RANDOM.nextBytes(challenge);
      challenges.put(listener, challenge);
      LOGGER.info("Starting Lapis login verification for '{}'.", listener.getUserName());
      FriendlyByteBuf payload = new FriendlyByteBuf(Unpooled.buffer());
      Protocol.writeChallenge(payload, new Protocol.Challenge(Protocol.VERSION, config.serverId, config.buildId, challenge));
      sender.sendPacket(Protocol.AUTH_CHANNEL, payload);
    });
    ServerLoginConnectionEvents.DISCONNECT.register((listener, server) -> challenges.remove(listener));
    ServerLoginNetworking.registerGlobalReceiver(Protocol.AUTH_CHANNEL, (server, listener, understood, buffer, synchronizer, sender) -> {
      byte[] challenge = challenges.remove(listener);
      if (!understood || challenge == null) {
        LOGGER.warn("Lapis login verification failed: no bridge response from '{}'.", listener.getUserName());
        listener.disconnect(Component.literal("Требуется запуск через Lapis Launcher."));
        return;
      }
      final Protocol.Response response;
      try {
        response = Protocol.readResponse(buffer);
      } catch (RuntimeException error) {
        LOGGER.warn("Lapis login verification failed: invalid response from '{}'.", listener.getUserName());
        listener.disconnect(Component.literal("Некорректная авторизация Lapis."));
        return;
      }
      synchronizer.waitFor(CompletableFuture.supplyAsync(() -> verify(listener, challenge, response))
          .thenCompose(result -> {
            if (result.accepted) {
              if (!SkinRestorerIntegration.apply(
                  offlinePlayerUuid(response.nickname()), response.nickname(), result.skin)) {
                LOGGER.warn("Lapis login will continue without a synchronized skin for '{}'.", listener.getUserName());
              }
              LOGGER.info("Lapis login verification succeeded for '{}'.", listener.getUserName());
              return CompletableFuture.completedFuture(null);
            }
            return server.submit(() -> {
              LOGGER.warn("Lapis login verification failed for '{}': {}", listener.getUserName(), result.message);
              listener.disconnect(Component.literal(result.message));
            });
          }));
    });
  }

  private Verification verify(ServerLoginPacketListenerImpl listener, byte[] challenge, Protocol.Response response) {
    if (config.sharedKey == null || response.protocolVersion() != Protocol.VERSION || !config.buildId.equals(response.buildId())) return Verification.denied("Версия Lapis Launcher устарела.");
    String echoed = Base64.getUrlEncoder().withoutPadding().encodeToString(challenge);
    if (!echoed.equals(response.echoedChallenge()) || !requestedNickname(listener).equals(response.nickname())) return Verification.denied("Авторизация Lapis не пройдена.");
    String expectedUuid = ticketMinecraftUuid(response.nickname());
    if (!expectedUuid.equalsIgnoreCase(response.minecraftUuid())) return Verification.denied("Профиль игрока не совпадает.");
    try {
      String body = "{\"ticket\":\"" + json(response.ticket()) + "\",\"serverId\":\"" + json(config.serverId) + "\"}";
      HttpRequest request = HttpRequest.newBuilder(URI.create(config.apiUrl + "/v1/game-tickets/consume"))
          .timeout(Duration.ofSeconds(5))
          .header("content-type", "application/json")
          .header("X-Lapis-Bridge-Key", config.sharedKey)
          .header("X-Lapis-Bridge-Capabilities", "signed-skin-v1")
          .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
      HttpResponse<String> result = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build().send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if (result.statusCode() != 200 || result.body().length() > 16_384) return Verification.denied("Игровой билет недействителен или истёк.");
      JsonObject payload = JsonParser.parseString(result.body()).getAsJsonObject();
      String nickname = requiredString(payload, "nickname");
      if (!NICKNAME.matcher(nickname).matches()
          || !response.nickname().equals(nickname))
        return Verification.denied("Игровой билет выдан другому профилю.");
      JsonElement minecraftUuid = payload.get("minecraftUuid");
      if (minecraftUuid != null
          && (!minecraftUuid.isJsonPrimitive()
              || !response.minecraftUuid().equalsIgnoreCase(minecraftUuid.getAsString())))
        return Verification.denied("Игровой билет выдан другому профилю.");
      return Verification.allowed(parseSkin(payload.get("skin")));
    } catch (Exception error) {
      return Verification.denied("Сервис авторизации Lapis недоступен.");
    }
  }

  private static String json(String value) { return value.replace("\\", "\\\\").replace("\"", "\\\""); }
  private static String requestedNickname(ServerLoginPacketListenerImpl listener) {
    // In 26.2 getUserName() is a display value: "nickname (/address)".
    String displayName = listener.getUserName();
    int addressStart = displayName.indexOf(" (");
    return addressStart < 0 ? displayName : displayName.substring(0, addressStart);
  }
  private static String ticketMinecraftUuid(String nickname) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(("OfflinePlayer:" + nickname).getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException("Could not calculate offline UUID", error);
    }
  }
  private static UUID offlinePlayerUuid(String nickname) {
    return UUID.nameUUIDFromBytes(("OfflinePlayer:" + nickname).getBytes(StandardCharsets.UTF_8));
  }
  private static String requiredString(JsonObject payload, String field) {
    JsonElement value = payload.get(field);
    if (value == null || !value.isJsonPrimitive()) throw new IllegalArgumentException("Missing field: " + field);
    return value.getAsString();
  }
  private static LapisSkin parseSkin(JsonElement element) {
    if (element == null || element.isJsonNull()) return null;
    JsonObject skin = element.getAsJsonObject();
    String value = requiredString(skin, "value");
    String signature = requiredString(skin, "signature");
    String textureUrl = requiredString(skin, "textureUrl");
    String model = requiredString(skin, "model");
    if (value.length() < 64 || value.length() > 8192 || !BASE64.matcher(value).matches()
        || signature.length() < 64 || signature.length() > 2048 || !BASE64.matcher(signature).matches()
        || !TEXTURE_URL.matcher(textureUrl).matches()
        || !("default".equals(model) || "slim".equals(model)))
      throw new IllegalArgumentException("Invalid signed skin payload");
    return new LapisSkin(value, signature, textureUrl, model);
  }
  private record Verification(boolean accepted, String message, LapisSkin skin) {
    static Verification allowed(LapisSkin skin) { return new Verification(true, "", skin); }
    static Verification denied(String message) { return new Verification(false, message, null); }
  }
  private record BridgeConfig(String apiUrl, String serverId, String buildId, String sharedKey) {
    static BridgeConfig fromEnvironment() {
      return new BridgeConfig(System.getenv().getOrDefault("LAPIS_API_URL", "http://127.0.0.1:3000"), System.getenv().getOrDefault("LAPIS_SERVER_ID", "main"), System.getenv().getOrDefault("LAPIS_BUILD_ID", "lapis-26.2-fabric-0.19.3"), System.getenv("LAPIS_BRIDGE_SHARED_KEY"));
    }
  }
}
