// modules/driver/driver.gateway.ts
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
    WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { forwardRef, Inject, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { DriverStatus } from '@prisma/client';
import { DriverAssignmentService } from '../../modules/driver/driver-assignment.service';

@WebSocketGateway({ namespace: 'driver', cors: true })
@UseGuards(WsJwtGuard)
export class DriverGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;

    constructor(
        @Inject(forwardRef(() => DriverAssignmentService))
        private readonly driverAssignmentService: DriverAssignmentService,
    ) { }

    handleConnection(client: Socket) {
        const driverId = client.data.user?.id;
        if (driverId) {
            client.join(`driver:${driverId}`);
            this.driverAssignmentService.setDriverSocket(driverId, client.id);
        }
    }

    handleDisconnect(client: Socket) {
        const driverId = client.data.user?.id;
        if (driverId) {
            this.driverAssignmentService.removeDriverSocket(driverId);
        }
    }

    /**
     * Emit a new delivery request to a specific driver.
     */
    emitNewOrderRequest(driverId: string, orderId: string, vendorLocation: any, etaSeconds: number) {
        this.server.to(`driver:${driverId}`).emit('new-order-request', {
            orderId,
            vendorLocation,
            etaSeconds,
            expiresIn: 60, // seconds to accept
        });
    }

    /**
     * Emit a timeout when driver didn't respond in time.
     */
    emitRequestTimeout(driverId: string, orderId: string) {
        this.server.to(`driver:${driverId}`).emit('request-timeout', { orderId });
    }

    /**
     * Driver sends periodic location updates.
     */
    @SubscribeMessage('driver-location')
    async handleDriverLocation(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { orderId: string; lat: number; lng: number; heading: number },
    ) {
        const driverId = client.data.user?.id;
        if (!driverId) throw new WsException('Unauthorized');
        await this.driverAssignmentService.handleDriverLocation({
            driverId,
            orderId: data.orderId,
            lat: data.lat,
            lng: data.lng,
            heading: data.heading,
        });
    }

    /**
     * Driver sets online/offline status.
     */
    @SubscribeMessage('driver-status')
    async handleDriverStatus(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { status: DriverStatus },
    ) {
        const driverId = client.data.user?.id;
        if (!driverId) throw new WsException('Unauthorized');
        await this.driverAssignmentService.updateDriverStatus(driverId, data.status);
        client.emit('status-updated', { status: data.status });
    }
}