package ru.lapis.bridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.buffer.ByteBuf;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.WeakHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.network.ConfigurationTask;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.network.configuration.ICustomConfigurationTask;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod("lapisbridge")
public final class LapisBridge {
    private static final Logger LOG = LoggerFactory.getLogger("LapisBridge");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private static final Map<ServerConfigurationPacketListenerImpl, byte[]> CHALLENGES = Collections.synchronizedMap(new WeakHashMap<>());
    private static final AtomicReference<JsonObject> PENDING_CLIENT_CONTEXT = new AtomicReference<>();
    private static final String API = System.getenv().getOrDefault("LAPIS_API_URL", "http://127.0.0.1:3000");
    private static final String SERVER_ID = System.getProperty("lapis.serverId", System.getenv().getOrDefault("LAPIS_SERVER_ID", "main"));
    private static final String BUILD_ID = System.getProperty("lapis.buildId", System.getenv().getOrDefault("LAPIS_BUILD_ID", "lapis-1.21.1-neoforge"));
    private static final String KEY = System.getenv("LAPIS_BRIDGE_SHARED_KEY");

    public LapisBridge(IEventBus bus) {
        bus.addListener(LapisBridge::registerPayloads);
        bus.addListener(LapisBridge::registerTask);
        LOG.info("Lapis NeoForge bridge loaded for server {} and build {}", SERVER_ID, BUILD_ID);
        if (KEY == null || KEY.isBlank()) LOG.error("LAPIS_BRIDGE_SHARED_KEY is missing; all Lapis logins will be denied.");
    }

    private static void registerPayloads(RegisterPayloadHandlersEvent event) {
        var registrar = event.registrar("1");
        registrar.configurationToClient(Challenge.TYPE, Challenge.CODEC, LapisBridge::onChallenge);
        registrar.configurationToServer(Response.TYPE, Response.CODEC, LapisBridge::onResponse);
    }

    private static void registerTask(RegisterConfigurationTasksEvent event) {
        if (!(event.getListener() instanceof ServerConfigurationPacketListenerImpl listener)) return;
        byte[] nonce = new byte[32];
        RANDOM.nextBytes(nonce);
        CHALLENGES.put(listener, nonce);
        event.register(new AuthTask(listener, nonce));
    }

    private record AuthTask(ServerConfigurationPacketListenerImpl listener, byte[] nonce) implements ICustomConfigurationTask {
        private static final ConfigurationTask.Type TYPE = new ConfigurationTask.Type(ResourceLocation.fromNamespaceAndPath("lapisbridge", "auth"));
        @Override public ConfigurationTask.Type type() { return TYPE; }
        @Override public void run(java.util.function.Consumer<CustomPacketPayload> sender) {
            sender.accept(new Challenge(1, SERVER_ID, BUILD_ID, Base64.getUrlEncoder().withoutPadding().encodeToString(nonce)));
        }
    }

    private static void onChallenge(Challenge challenge, IPayloadContext context) {
        CompletableFuture.supplyAsync(() -> clientReply(challenge)).whenComplete((response, error) -> {
            if (error != null) context.disconnect(Component.literal("Требуется запуск через Lapis Launcher."));
            else context.reply(response);
        });
    }

    private static Response clientReply(Challenge challenge) {
        try {
            JsonObject json = PENDING_CLIENT_CONTEXT.getAndSet(null);
            if (json == null || Instant.parse(json.get("expiresAt").getAsString()).isBefore(Instant.now().plusSeconds(5)))
                json = readLaunchContext();
            if (Instant.parse(json.get("expiresAt").getAsString()).isBefore(Instant.now())
                    || challenge.version() != 1
                    || !challenge.serverId().equals(json.get("serverId").getAsString())
                    || !challenge.buildId().equals(json.get("buildId").getAsString())
                    || json.get("bridgeProtocolVersion").getAsInt() != 1) throw new IllegalStateException("Context mismatch");
            return new Response(json.get("ticket").getAsString(), challenge.nonce(), json.get("nickname").getAsString(), json.get("minecraftUuid").getAsString(), challenge.buildId(), 1);
        } catch (Exception exception) {
            throw new IllegalStateException("Launcher context unavailable", exception);
        }
    }

    static JsonObject readLaunchContext() {
        String port = System.getenv("LAPIS_BRIDGE_PORT");
        String nonce = System.getenv("LAPIS_BRIDGE_NONCE");
        if (port == null || nonce == null || !port.matches("[0-9]{1,5}")) throw new IllegalStateException("No launcher context");
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/v1/launch-context"))
                    .timeout(Duration.ofSeconds(5)).header("X-Lapis-Bootstrap", nonce)
                    .POST(HttpRequest.BodyPublishers.noBody()).build();
            HttpResponse<String> result = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (result.statusCode() != 200 || result.body().length() > 2048) throw new IllegalStateException("Context rejected");
            return JsonParser.parseString(result.body()).getAsJsonObject();
        } catch (Exception exception) {
            throw new IllegalStateException("Launcher context unavailable", exception);
        }
    }

    static void holdLaunchContext(JsonObject json) { PENDING_CLIENT_CONTEXT.set(json); }

    private static void onResponse(Response response, IPayloadContext context) {
        if (!(context.listener() instanceof ServerConfigurationPacketListenerImpl listener)) return;
        byte[] challenge = CHALLENGES.remove(listener);
        if (challenge == null || KEY == null || KEY.isBlank()
                || response.version() != 1 || !BUILD_ID.equals(response.buildId())
                || !Arrays.equals(challenge, decodeNonce(response.nonce()))
                || !listener.getOwner().getName().equals(response.nickname())
                || !offlineUuid(listener.getOwner().getName()).equals(listener.getOwner().getId())
                || !rawOfflineUuid(response.nickname()).equalsIgnoreCase(response.uuid())) {
            context.disconnect(Component.literal("Авторизация Lapis не пройдена."));
            return;
        }
        CompletableFuture.supplyAsync(() -> consumeTicket(response)).whenComplete((valid, error) -> context.enqueueWork(() -> {
            if (error != null || !valid) context.disconnect(Component.literal("Игровой билет Lapis недействителен или сервис недоступен."));
            else context.finishCurrentTask(AuthTask.TYPE);
        }));
    }

    private static byte[] decodeNonce(String value) {
        try { return Base64.getUrlDecoder().decode(value); } catch (IllegalArgumentException error) { return new byte[0]; }
    }

    private static UUID offlineUuid(String nickname) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + nickname).getBytes(StandardCharsets.UTF_8));
    }

    private static String rawOfflineUuid(String nickname) {
        try {
            byte[] bytes = ("OfflinePlayer:" + nickname).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(bytes));
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IllegalStateException("MD5 unavailable", error);
        }
    }

    private static boolean consumeTicket(Response response) {
        try {
            JsonObject body = new JsonObject();
            body.addProperty("ticket", response.ticket());
            body.addProperty("serverId", SERVER_ID);
            HttpRequest request = HttpRequest.newBuilder(URI.create(API + "/v1/game-tickets/consume"))
                    .timeout(Duration.ofSeconds(5)).header("content-type", "application/json")
                    .header("X-Lapis-Bridge-Key", KEY)
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8)).build();
            HttpResponse<String> result = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (result.statusCode() != 200 || result.body().length() > 16_384) return false;
            JsonObject payload = JsonParser.parseString(result.body()).getAsJsonObject();
            return response.nickname().equals(payload.get("nickname").getAsString())
                    && (!payload.has("minecraftUuid") || response.uuid().equalsIgnoreCase(payload.get("minecraftUuid").getAsString()));
        } catch (Exception error) {
            LOG.warn("Lapis ticket validation failed: {}", error.toString());
            return false;
        }
    }

    public record Challenge(int version, String serverId, String buildId, String nonce) implements CustomPacketPayload {
        public static final Type<Challenge> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("lapisbridge", "challenge"));
        public static final StreamCodec<ByteBuf, Challenge> CODEC = StreamCodec.of((buffer, value) -> {
            FriendlyByteBuf out = new FriendlyByteBuf(buffer);
            out.writeVarInt(value.version); out.writeUtf(value.serverId, 255); out.writeUtf(value.buildId, 255); out.writeUtf(value.nonce, 64);
        }, buffer -> {
            FriendlyByteBuf in = new FriendlyByteBuf(buffer);
            return new Challenge(in.readVarInt(), in.readUtf(255), in.readUtf(255), in.readUtf(64));
        });
        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
    }

    public record Response(String ticket, String nonce, String nickname, String uuid, String buildId, int version) implements CustomPacketPayload {
        public static final Type<Response> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("lapisbridge", "response"));
        public static final StreamCodec<ByteBuf, Response> CODEC = StreamCodec.of((buffer, value) -> {
            FriendlyByteBuf out = new FriendlyByteBuf(buffer);
            out.writeUtf(value.ticket, 128); out.writeUtf(value.nonce, 64); out.writeUtf(value.nickname, 16);
            out.writeUtf(value.uuid, 32); out.writeUtf(value.buildId, 255); out.writeVarInt(value.version);
        }, buffer -> {
            FriendlyByteBuf in = new FriendlyByteBuf(buffer);
            return new Response(in.readUtf(128), in.readUtf(64), in.readUtf(16), in.readUtf(32), in.readUtf(255), in.readVarInt());
        });
        @Override public Type<? extends CustomPacketPayload> type() { return TYPE; }
    }
}
