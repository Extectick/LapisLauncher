package ru.lapis.bridge;

import com.google.gson.JsonObject;
import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;

@EventBusSubscriber(modid = "lapisbridge", value = Dist.CLIENT)
public final class ClientConnect {
    private static boolean started;

    private ClientConnect() { }

    @SubscribeEvent
    public static void onTick(ClientTickEvent.Post event) {
        Minecraft client = Minecraft.getInstance();
        if (started || client.getConnection() != null || !client.isGameLoadFinished()) return;
        started = true;
        CompletableFuture.supplyAsync(LapisBridge::readLaunchContext).whenComplete((context, error) -> client.execute(() -> {
            if (error != null) return;
            if (Instant.parse(context.get("expiresAt").getAsString()).isBefore(Instant.now().plusSeconds(5))) return;
            String host = context.get("host").getAsString();
            int port = context.get("port").getAsInt();
            if (host.isBlank() || port < 1 || port > 65535) return;
            LapisBridge.holdLaunchContext(context);
            String address = host + ":" + port;
            ServerData server = new ServerData(context.get("serverName").getAsString(), address, ServerData.Type.OTHER);
            server.setResourcePackStatus(ServerData.ServerPackStatus.ENABLED);
            rememberServer(client, server);
            ConnectScreen.startConnecting(new TitleScreen(), client, new ServerAddress(host, port), server, false, null);
        }));
    }

    private static void rememberServer(Minecraft client, ServerData selected) {
        ServerList servers = new ServerList(client);
        servers.load();
        ServerData saved = null;
        for (int index = 0; index < servers.size(); index++) {
            ServerData candidate = servers.get(index);
            if (selected.ip.equals(candidate.ip)) { saved = candidate; break; }
        }
        if (saved == null) {
            saved = selected;
            servers.add(saved, false);
        }
        saved.name = selected.name;
        saved.ip = selected.ip;
        saved.setResourcePackStatus(ServerData.ServerPackStatus.ENABLED);
        servers.save();
    }
}
