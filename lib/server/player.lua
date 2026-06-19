---@diagnostic disable: redundant-parameter
---@class OxPlayerServer : OxClass
local OxPlayer = lib.class('OxPlayer')

function OxPlayer:__index(index)
    local value = OxPlayer[index] --[[@as any]]

    if type(value) == 'function' then
        self[index] = value == OxPlayer.__call and function(...)
            return value(self, index, ...)
        end or function(...)
            return value(self, ...)
        end

        return self[index]
    end

    return value
end

function OxPlayer:constructor(data)
    for k, v in pairs(data) do
        self[k] = v
    end
end

function OxPlayer:__call(...)
    return exports.fox_core:CallPlayer(self.source, ...)
end

function OxPlayer:__tostring()
    return string.format('{\n  "source": %s\n  "userId": %s\n  "identifier": %s\n  "username": %s\n}', self.source,
        self.userId, self.identifier, self.username)
end

function OxPlayer:getCoords()
    return GetEntityCoords(self.ped);
end

function OxPlayer:getState()
    return Player(self.source).state;
end

function OxPlayer:getGroup(filter)
    local result = OxPlayer.__call(self, 'getGroup', filter)

    if type(result) == 'table' then
        return table.unpack(result)
    end

    return result
end

function OxPlayer:getAccount()
    return self.charId and Ox.GetCharacterAccount(self.charId) or nil
end

function OxPlayer:getGroupByType(type)
    local result = OxPlayer.__call(self, 'getGroupByType', type)

    if result then
        return table.unpack(result)
    end
end

--[[ Calling a not-yet-registered export throws ("No such export ..."), which would
     abort the consumer's require chain. Guard it so a load-order/timing gap only
     means the dynamic proxy methods are skipped, not a hard crash. ]]
local ok, calls = pcall(function() return exports.fox_core:GetPlayerCalls() end)

if not ok then
    print(('^3[fox_core]^0 GetPlayerCalls() unavailable (%s); dynamic OxPlayer methods skipped'):format(calls))
    calls = nil
end

for method in pairs(calls or {}) do
    if not rawget(OxPlayer, method) then OxPlayer[method] = OxPlayer.__call end
end

local function CreatePlayerInstance(player)
    if not player then return end;

    return OxPlayer:new(player)
end

---@class OxServer
local Ox = Ox

function Ox.GetPlayer(playerId)
    return CreatePlayerInstance(exports.fox_core:GetPlayer(playerId))
end

function Ox.GetPlayerFromUserId(userId)
    return CreatePlayerInstance(exports.fox_core:GetPlayerFromUserId(userId))
end

function Ox.GetPlayerFromCharId(charId)
    return CreatePlayerInstance(exports.fox_core:GetPlayerFromCharId(charId))
end

function Ox.GetPlayers(filter)
    local players = exports.fox_core:GetPlayers(filter)

    for i = 1, #players do
        players[i] = CreatePlayerInstance(players[i])
    end

    return players
end

function Ox.GetPlayerFromFilter(filter)
    return CreatePlayerInstance(exports.fox_core:GetPlayerFromFilter(filter))
end
